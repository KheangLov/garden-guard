/**
 * The garden in 3D, in plain three.js: the lawn seen from above at an angle with soft shadows, the
 * house and patio on the left, the street on the right where the Bolt-Bots come from, and every
 * plant, robot, shot and dew drop following the engine. Labels (health bars) are HTML laid over the
 * canvas. The view never changes the game: it reads the engine's state each frame and reacts to its
 * events with effects. Taps are turned back into board points for the engine.
 *
 * Quality 'high': shadows, antialiasing, up to 2x pixel ratio. 'low': no shadows, 1x pixels.
 */
import {
  ACESFilmicToneMapping, BoxGeometry, Color, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight,
  IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PCFSoftShadowMap,
  PerspectiveCamera, Plane, PlaneGeometry, Quaternion, Raycaster, RingGeometry, Scene, SRGBColorSpace, Vector2,
  Vector3, WebGLRenderer, type Material, type Object3D,
} from 'three'
import {
  BOARD, LAWN_RIGHT, PLANTS, ROBOTS, WORLDS, cellX, rowY,
  type Engine, type GameEvent, type LevelDef, type PlantId,
} from '#shared/game'
import { bake, geo, mat, paint, part, rng } from './kit'
import { makeModel, type ModelName } from './models'

export type Quality = 'high' | 'low'

export interface BoardUi {
  /** Tile under the pointer. */
  hover: { r: number, c: number } | null
  /** The seed being planted, if any. */
  seed: PlantId | null
  shovel: boolean
  /** Where a dragged seed is (board units). */
  drag: { x: number, y: number } | null
}

/** Board units to world units (one world unit is 100 board units; the board's centre is 0). */
const wx = (x: number) => (x - BOARD.width / 2) / 100
const rowZ = (r: number) => (BOARD.y + r * BOARD.cellH + BOARD.cellH / 2 - BOARD.height / 2) / 100
const bx = (x: number) => x * 100 + BOARD.width / 2
const by = (z: number) => z * 100 + BOARD.height / 2
const rowOf = (y: number) => Math.max(0, Math.min(BOARD.rows - 1, Math.floor((y - BOARD.y) / BOARD.cellH)))

/** A point of the 2D board (x, and a screen y in a row) as a point of the 3D world. */
function toWorld(x: number, y: number, out = new Vector3()) {
  const r = rowOf(y)
  return out.set(wx(x), Math.max(0, (rowY(r) - y) / 100), rowZ(r))
}

const LAWN_X0 = wx(BOARD.x)
const LAWN_X1 = wx(LAWN_RIGHT)
const LAWN_Z0 = rowZ(0) - BOARD.cellH / 200
const LAWN_Z1 = rowZ(BOARD.rows - 1) + BOARD.cellH / 200

interface Particle { on: boolean, p: Vector3, v: Vector3, life: number, max: number, size: number, g: number }
interface Popup { el: HTMLElement, p: Vector3, t: number }

export class LawnView {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(30, 1, 0.5, 140)
  private root = new Group()
  private plants = new Map<number, { obj: Group, pose: Object3D, name: ModelName, light: Object3D | null }>()
  private robots = new Map<number, { obj: Group, pose: Object3D, name: ModelName, aura: Mesh }>()
  private shots: ({ obj: Group, kind: string } | null)[] = []
  private dews: Group[] = []
  private carts: Group[] = []
  private ghost: { obj: Group, name: string } | null = null
  private tile: Mesh
  private lane: Mesh
  private laser: Mesh
  private laserRing: Mesh
  private parts: Particle[] = []
  private partMesh: InstancedMesh
  private rings: { mesh: Mesh, t: number }[] = []
  private rain: InstancedMesh | null = null
  private rainDrops: Vector3[] = []
  private fog: Group | null = null
  private popups: Popup[] = []
  private labels = new Map<string, { el: HTMLElement, html: string, seen: boolean }>()
  private flashEl: HTMLElement
  private ghostMat = new MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false })
  private auraMat = new MeshBasicMaterial({ color: '#8fe0ff', transparent: true, opacity: 0.35, depthWrite: false })
  private flashMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false })
  private time = 0
  private lastStats = -1
  private shake = 0
  private flash = 0
  private lightning = 0
  private lightningT = 8
  private width = 1
  private height = 1
  private night: boolean
  private ray = new Raycaster()
  private v = new Vector3()
  private m4 = new Matrix4()
  private q = new Quaternion()
  private sun: DirectionalLight
  private hemi: HemisphereLight
  reducedMotion = false

  /** A turning view for menus (no labels, a lower camera), or the game's own fixed view. */
  readonly scenic: boolean
  private yaw = 0

  constructor(private canvas: HTMLCanvasElement, private overlay: HTMLElement, private level: LevelDef, readonly quality: Quality, opts: { scenic?: boolean } = {}) {
    this.scenic = !!opts.scenic
    this.renderer = new WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = quality === 'high'
    this.renderer.shadowMap.type = PCFSoftShadowMap

    const world = WORLDS[level.world]!
    this.night = level.night
    const p = world.palette
    this.scene.background = new Color(this.night ? '#101830' : p.sky)
    this.scene.fog = new Fog(this.night ? '#101830' : p.sky, 24, 50)
    this.hemi = new HemisphereLight(this.night ? '#8a9ae8' : '#e8f4ff', this.night ? '#2a3a3a' : '#6a7a4a', this.night ? 1.35 : 1.2)
    this.scene.add(this.hemi)
    this.sun = new DirectionalLight(this.night ? '#b4c4ff' : level.rain ? '#dfe8f0' : '#fff1d6', this.night ? 1.8 : level.rain ? 1.6 : 2.4)
    this.sun.position.set(-5, 11, 6)
    this.sun.castShadow = quality === 'high'
    this.sun.shadow.mapSize.set(2048, 2048)
    Object.assign(this.sun.shadow.camera, { left: -9, right: 9, top: 6, bottom: -6, near: 1, far: 30 })
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.02
    this.scene.add(this.sun)
    this.scene.add(this.root)

    this.buildGround()
    this.buildDecor()

    const tileMat = new MeshBasicMaterial({ color: '#fff7c2', transparent: true, opacity: 0.35, depthWrite: false })
    this.tile = new Mesh(new PlaneGeometry(BOARD.cellW / 100 - 0.08, BOARD.cellH / 100 - 0.08), tileMat)
    this.tile.rotation.x = -Math.PI / 2
    this.tile.position.y = 0.035
    this.tile.visible = false
    this.root.add(this.tile)
    this.lane = new Mesh(new PlaneGeometry(1, BOARD.cellH / 100 * 0.3), new MeshBasicMaterial({ color: '#fff7c2', transparent: true, opacity: 0.16, depthWrite: false }))
    this.lane.rotation.x = -Math.PI / 2
    this.lane.position.y = 0.03
    this.lane.visible = false
    this.root.add(this.lane)
    this.laser = new Mesh(new CylinderGeometry(0.04, 0.04, 1, 8, 1, true), new MeshBasicMaterial({ color: '#ff4d6d', transparent: true, opacity: 0.7, depthWrite: false }))
    this.laser.visible = false
    this.root.add(this.laser)
    this.laserRing = new Mesh(new RingGeometry(0.3, 0.38, 32), new MeshBasicMaterial({ color: '#ff4d6d', transparent: true, opacity: 0.8, depthWrite: false }))
    this.laserRing.rotation.x = -Math.PI / 2
    this.laserRing.visible = false
    this.root.add(this.laserRing)

    const n = quality === 'high' ? 500 : 240
    this.partMesh = new InstancedMesh(new IcosahedronGeometry(1, 0), mat('#ffffff', { rough: 0.5 }), n)
    this.partMesh.frustumCulled = false
    for (let i = 0; i < n; i++) {
      this.parts.push({ on: false, p: new Vector3(), v: new Vector3(), life: 0, max: 1, size: 0, g: 0 })
      this.m4.makeScale(0, 0, 0)
      this.partMesh.setMatrixAt(i, this.m4)
      this.partMesh.setColorAt(i, new Color('#ffffff'))
    }
    this.root.add(this.partMesh)
    for (let i = 0; i < 8; i++) {
      const mesh = new Mesh(new RingGeometry(0.85, 1, 40), new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }))
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = 0.05
      mesh.visible = false
      this.root.add(mesh)
      this.rings.push({ mesh, t: 0 })
    }
    for (let r = 0; r < BOARD.rows; r++) {
      const c = makeModel('cart')
      c.position.set(wx(52), 0, rowZ(r))
      this.root.add(c)
      this.carts.push(c)
    }

    this.flashEl = document.createElement('div')
    this.flashEl.className = 'lv-flash'
    this.overlay.appendChild(this.flashEl)
  }

  /* ------------------------------ The world ------------------------------ */

  private buildGround() {
    const world = WORLDS[this.level.world]!
    const p = world.palette
    const L = this.level
    const ground = part(this.root, new PlaneGeometry(80, 80), mat('#ffffff', { rough: 1, map: paint(`gg-ground-${world.id}`, 256, (g, s) => {
      g.fillStyle = shadeHex(p.grassB, -0.18)
      g.fillRect(0, 0, s, s)
      const R = rng(7)
      g.lineWidth = 1.2
      for (let i = 0; i < 1400; i++) {
        const x = R() * s
        const y = R() * s
        g.strokeStyle = R() < 0.5 ? 'rgba(20,60,10,.25)' : 'rgba(230,255,190,.12)'
        g.beginPath()
        g.moveTo(x, y)
        g.lineTo(x + (R() - 0.5) * 3, y - 3 - R() * 4)
        g.stroke()
      }
    }, 16, 16) }), [0, -0.01, 0], [-Math.PI / 2, 0, 0])
    ground.receiveShadow = true

    // The lawn: tiles in two greens (soil on rows not in play), raised a little.
    const lawn = new Group()
    const R = rng(L.n * 11 + 3)
    for (let r = 0; r < BOARD.rows; r++) {
      for (let c = 0; c < BOARD.cols; c++) {
        const active = L.rows.includes(r)
        const color = active ? ((r + c) % 2 ? p.grassA : p.grassB) : '#7a5a3a'
        const tile = part(lawn, geo.rbox(BOARD.cellW / 100 - 0.01, 0.08, BOARD.cellH / 100 - 0.01, 0.02), mat(shadeHex(color, (R() - 0.5) * 0.04), { rough: 0.95 }), [wx(cellX(c)), 0.0, rowZ(r)])
        tile.receiveShadow = true
      }
    }
    // Grass tufts all over the lawn.
    for (let i = 0; i < 160; i++) {
      const x = LAWN_X0 + 0.05 + R() * (LAWN_X1 - LAWN_X0 - 0.1)
      const z = LAWN_Z0 + 0.05 + R() * (LAWN_Z1 - LAWN_Z0 - 0.1)
      if (!L.rows.includes(rowOf(by(z)))) continue
      part(lawn, geo.cone(0.018, 0.1, 4), mat(shadeHex(p.grassB, -0.25)), [x, 0.08, z], [(R() - 0.5) * 0.5, 0, (R() - 0.5) * 0.5])
    }
    // The patio on the left, the street on the right.
    part(lawn, geo.rbox(1.8, 0.06, LAWN_Z1 - LAWN_Z0 + 0.6, 0.02), mat('#ffffff', { rough: 0.9, map: paint(`patio-${world.id}`, 128, (g, s) => {
      g.fillStyle = p.patio
      g.fillRect(0, 0, s, s)
      g.strokeStyle = p.patioLine
      g.lineWidth = 3
      for (let y = 0; y < s; y += 32) {
        g.strokeRect(0, y, s / 2, 32)
        g.strokeRect(s / 2, y + 16, s / 2, 32)
      }
    }, 1, 4) }), [LAWN_X0 - 0.9, -0.005, (LAWN_Z0 + LAWN_Z1) / 2])
    const street = part(lawn, new PlaneGeometry(4.6, 30), mat(p.road, { rough: 0.85 }), [LAWN_X1 + 2.35, 0.004, 0], [-Math.PI / 2, 0, 0])
    street.receiveShadow = true
    part(lawn, geo.box(0.12, 0.08, 30), mat(p.edge, { rough: 0.8 }), [LAWN_X1 + 0.08, 0.04, 0])
    for (let z = -14; z < 14; z += 0.9) part(lawn, geo.box(0.07, 0.01, 0.42), mat('#f2d14c', { rough: 0.6 }), [LAWN_X1 + 0.72, 0.012, z])
    // Blocked tiles: rubble.
    for (const [r, c] of L.blocked) {
      const m = makeModel('rubble')
      m.position.set(wx(cellX(c)), 0.04, rowZ(r))
      m.rotation.y = R() * Math.PI
      lawn.add(m)
    }
    this.root.add(bake(lawn, this.quality === 'high'))

    const house = makeModel('house')
    house.position.set(LAWN_X0 - 2.6, 0, (LAWN_Z0 + LAWN_Z1) / 2)
    this.root.add(house)

    if (L.fogCols) {
      const fog = new Group()
      const fogMat = new MeshBasicMaterial({ color: '#e4ecf0', transparent: true, opacity: 0.55, depthWrite: false })
      const w = L.fogCols * BOARD.cellW / 100 + 1.4
      for (let i = 0; i < 26; i++) {
        const puff = new Mesh(geo.sphere(1, 12, 8), fogMat)
        puff.position.set(LAWN_X1 - w + 0.7 + R() * w, 0.3 + R() * 0.5, LAWN_Z0 + R() * (LAWN_Z1 - LAWN_Z0))
        puff.scale.set(0.7 + R() * 0.6, 0.35 + R() * 0.3, 0.6 + R() * 0.5)
        fog.add(puff)
      }
      this.fog = fog
      this.root.add(fog)
    }
    if (L.rain) {
      const count = this.quality === 'high' ? 420 : 200
      this.rain = new InstancedMesh(new BoxGeometry(0.012, 0.32, 0.012), new MeshBasicMaterial({ color: '#c8dcff', transparent: true, opacity: 0.45 }), count)
      this.rain.frustumCulled = false
      for (let i = 0; i < count; i++) this.rainDrops.push(new Vector3(-8 + R() * 16, R() * 8, -5 + R() * 10))
      this.root.add(this.rain)
    }
  }

  private buildDecor() {
    const world = WORLDS[this.level.world]!
    const R = rng(this.level.n * 17 + 3)
    const decor = new Group()
    const put = (name: ModelName, x: number, z: number, s = 1) => {
      const m = makeModel(name)
      m.position.set(x, 0, z)
      m.scale.setScalar(s)
      m.rotation.y = R() * Math.PI * 2
      decor.add(m)
    }
    // A hedge and trees behind the garden, bushes in front.
    for (let x = -10; x <= 4.6; x += 1.2 + R() * 0.6) put(R() < 0.7 ? (world.decor === 'reeds' || world.decor === 'rice' ? 'palm' : 'tree') : 'bush', x, LAWN_Z0 - 1 - R() * 1.6, 0.9 + R() * 0.5)
    for (let x = -9; x <= 4.6; x += 1.4 + R()) put('bush', x, LAWN_Z1 + 0.8 + R() * 0.8, 0.9 + R() * 0.4)
    for (let i = 0; i < 26; i++) {
      const x = LAWN_X0 + 0.1 + R() * (LAWN_X1 - LAWN_X0 - 0.2)
      const z = LAWN_Z0 + 0.1 + R() * (LAWN_Z1 - LAWN_Z0 - 0.2)
      if (!this.level.rows.includes(rowOf(by(z)))) continue
      const small: Record<string, ModelName> = { flowers: 'flower', fireflies: 'flower', rice: 'rice', stones: 'stone', reeds: 'reed', bolts: 'bolt' }
      put(small[world.decor]!, x, z, world.decor === 'rice' || world.decor === 'reeds' ? 0.6 : 1)
    }
    if (this.night) {
      for (let i = 0; i < 6; i++) {
        const lantern = makeModel('lantern')
        lantern.position.set(-8 + i * 2.3, 1.8, LAWN_Z0 - 0.7)
        decor.add(lantern)
      }
    }
    this.root.add(bake(decor, this.quality === 'high'))
  }

  /* ------------------------------ Camera ------------------------------ */

  resize(cssWidth: number, cssHeight: number, dpr: number) {
    this.width = cssWidth
    this.height = cssHeight
    this.renderer.setPixelRatio(this.quality === 'high' ? Math.min(dpr, 2) : 1)
    this.renderer.setSize(cssWidth, cssHeight, false)
    this.camera.aspect = cssWidth / cssHeight
    this.fit()
  }

  /**
   * Places the camera so the lawn, the carts and a bit of the street just fit. On a screen taller
   * than wide, it looks along the rows instead, so the robots come down the screen.
   */
  private fit() {
    const pitch = this.scenic ? 0.46 : 0.64
    const tall = this.camera.aspect < 0.95
    const yaw = (tall ? Math.PI / 2 : 0) + this.yaw
    const target = new Vector3(tall ? 0.3 : 0.1, 0, tall ? 0.05 : 0.25)
    const dir = new Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw))
    const pts: Vector3[] = []
    for (const [x, z] of [[LAWN_X0 - 1.5, LAWN_Z0], [LAWN_X1 + 1.0, LAWN_Z0], [LAWN_X0 - 1.5, LAWN_Z1], [LAWN_X1 + 1.0, LAWN_Z1]] as const) {
      pts.push(new Vector3(x, 0, z), new Vector3(x, 1.3, z))
    }
    let lo = 4
    let hi = 80
    for (let i = 0; i < 28; i++) {
      const d = (lo + hi) / 2
      this.camera.position.copy(target).addScaledVector(dir, d)
      this.camera.lookAt(target)
      this.camera.updateMatrixWorld()
      this.camera.updateProjectionMatrix()
      const edge = this.scenic ? 0.82 : 0.97
      const ok = pts.every((p) => {
        const s = p.clone().project(this.camera)
        return Math.abs(s.x) <= edge && Math.abs(s.y) <= edge
      })
      if (ok) hi = d
      else lo = d
    }
    this.camera.position.copy(target).addScaledVector(dir, hi)
    this.camera.lookAt(target)
    this.camera.far = hi + 60
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld()
    const fog = this.scene.fog as Fog
    fog.near = hi + 5
    fog.far = hi + 30
  }

  /** Turns a scenic view round the garden (radians). */
  orbit(yaw: number) {
    this.yaw = yaw
    this.fit()
  }

  /** Puts a model somewhere for show (the menus' garden: robots waiting on the street). */
  addProp(name: ModelName, x: number, z: number, yaw = 0, scale = 1) {
    const m = makeModel(name)
    m.position.set(x, 0, z)
    m.rotation.y = yaw
    m.scale.setScalar(scale)
    this.root.add(m)
    return m
  }

  /* ------------------------------ Input ------------------------------ */

  private screenOf(p: Vector3) {
    const s = this.v.copy(p).project(this.camera)
    return { x: (s.x + 1) / 2 * this.width, y: (1 - s.y) / 2 * this.height }
  }

  /** The board point (x, y) on the ground under a screen point (CSS pixels in the canvas). */
  groundAt(px: number, py: number) {
    this.ray.setFromCamera(new Vector2(px / this.width * 2 - 1, -(py / this.height) * 2 + 1), this.camera)
    const hit = new Vector3()
    if (!this.ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -0.04), hit)) return null
    return { x: bx(hit.x), y: by(hit.z) }
  }

  /** The dew drop under a screen point, as the board point the engine collects it at. */
  dewAt(engine: Engine, px: number, py: number, touch: boolean) {
    const reach = (touch ? 50 : 36) * Math.max(0.7, Math.min(1.4, this.width / 1100))
    let best: { x: number, y: number } | null = null
    let bestD = reach
    for (const d of engine.dews) {
      if (d.collected) continue
      const s = this.screenOf(this.dewPos(d).add(this.v.set(0, 0.17, 0)))
      const dist = Math.hypot(s.x - px, s.y - py)
      if (dist < bestD) {
        bestD = dist
        best = { x: d.x, y: d.y }
      }
    }
    return best
  }

  /** The tile at a board point, if it's on the lawn. */
  static tileAt(x: number, y: number) {
    const c = Math.floor((x - BOARD.x) / BOARD.cellW)
    const r = Math.floor((y - BOARD.y) / BOARD.cellH)
    return c >= 0 && c < BOARD.cols && r >= 0 && r < BOARD.rows ? { r, c } : null
  }

  /* ------------------------------ Effects ------------------------------ */

  private emit(at: Vector3, n: number, colors: string[], o: { speed?: [number, number], up?: number, life?: [number, number], size?: [number, number], g?: number } = {}) {
    if (this.reducedMotion) n = Math.ceil(n / 3)
    const [s0, s1] = o.speed ?? [0.6, 2]
    const [l0, l1] = o.life ?? [0.4, 0.8]
    const [z0, z1] = o.size ?? [0.03, 0.06]
    const color = new Color()
    let i = 0
    for (let k = 0; k < n; k++) {
      while (i < this.parts.length && this.parts[i]!.on) i++
      if (i >= this.parts.length) break
      const p = this.parts[i]!
      const a = Math.random() * Math.PI * 2
      const s = s0 + Math.random() * (s1 - s0)
      p.on = true
      p.p.copy(at)
      p.v.set(Math.cos(a) * s * 0.6, (o.up ?? 1) * (0.5 + Math.random()) * s, Math.sin(a) * s * 0.6)
      p.max = p.life = l0 + Math.random() * (l1 - l0)
      p.size = z0 + Math.random() * (z1 - z0)
      p.g = o.g ?? 6
      this.partMesh.setColorAt(i, color.set(colors[Math.floor(Math.random() * colors.length)]!))
    }
    if (this.partMesh.instanceColor) this.partMesh.instanceColor.needsUpdate = true
  }

  private ring(at: Vector3, radius: number, color: string) {
    const r = this.rings.find(x => x.t <= 0) ?? this.rings[0]!
    r.t = 0.5
    r.mesh.position.set(at.x, 0.06, at.z)
    r.mesh.scale.setScalar(radius)
    ;(r.mesh.material as MeshBasicMaterial).color.set(color)
    r.mesh.visible = true
  }

  private popup(at: Vector3, html: string) {
    const el = document.createElement('div')
    el.className = 'lv-popup'
    el.innerHTML = html
    this.overlay.appendChild(el)
    this.popups.push({ el, p: at.clone(), t: 0 })
  }

  /** Effects for what just happened in the game. */
  handle(events: GameEvent[]) {
    const at = new Vector3()
    for (const e of events) {
      switch (e.type) {
        case 'shoot':
          toWorld(e.x, e.y, at)
          this.emit(at, 2, e.kind === 'frost' ? ['#e6fbff'] : e.kind === 'leaf' ? ['#c8f59a'] : ['#ffe2a8'], { speed: [0.2, 0.6], g: -0.5, size: [0.03, 0.05], life: [0.1, 0.2] })
          break
        case 'hit': {
          toWorld(e.x, e.y, at)
          const colors = e.kind === 'frost' ? ['#bff4ff', '#ffffff'] : e.kind === 'leaf' ? ['#9be15d', '#e9ffd0'] : e.kind === 'seed' ? ['#ff9cc9', '#ffe0ef'] : e.kind === 'spike' ? ['#e8f06a'] : ['#ffcf4a', '#ff7a1a']
          this.emit(at, e.armor ? 5 : 4, e.armor ? ['#dfe7ef', '#ffffff', ...colors] : colors, { speed: [0.8, 2], g: 4, size: [0.025, 0.045], life: [0.15, 0.35] })
          break
        }
        case 'armorOff':
          toWorld(e.x, e.y, at)
          this.emit(at.setY(at.y + 0.6), 16, e.kind === 'pogo' ? ['#c9a227', '#8ea880'] : ['#5b6f86', '#2b3644', '#8a9bb0', '#7fa4c4'], { speed: [1.2, 3], g: 9, size: [0.04, 0.09], life: [0.5, 0.9] })
          break
        case 'kill':
          toWorld(e.x, e.y, at)
          this.emit(at.setY(at.y + 0.4), e.robot === 'boss' ? 70 : 18, ['#9aa8b8', '#6b7785', '#c9a227', '#4a5563'], { speed: [1.2, e.robot === 'boss' ? 6 : 3.4], g: 9, size: [0.04, 0.08], life: [0.5, 1] })
          this.emit(at, 8, ['#ffe14d', '#ffffff'], { speed: [0.8, 2], g: 0, size: [0.02, 0.04], life: [0.2, 0.4] })
          if (e.robot === 'tank') this.shake = Math.max(this.shake, 0.08)
          break
        case 'explode':
          toWorld(e.x, e.y, at)
          this.ring(at, e.radius / 100, '#fff3b0')
          this.ring(at, e.radius / 160, e.kind === 'boss' ? '#ff4d6d' : '#ff9a1a')
          this.emit(at.setY(at.y + 0.3), e.kind === 'coconut' ? 26 : 46, ['#ff7a1a', '#ffcf4a', '#ff4d1a', '#fff3b0'], { speed: [1.5, e.radius / 40], g: 3, size: [0.05, 0.12], life: [0.3, 0.8] })
          if (e.kind === 'corn') this.emit(at, 30, ['#fffdf2', '#fff3c4'], { speed: [2, 4.8], g: 9, size: [0.05, 0.08], life: [0.6, 1.2] })
          this.shake = Math.max(this.shake, e.kind === 'boss' ? 0.25 : e.kind === 'corn' ? 0.16 : 0.1)
          this.flash = Math.max(this.flash, e.kind === 'boss' ? 0.8 : 0.35)
          break
        case 'plant':
          toWorld(e.x, e.y, at)
          this.emit(at, 14, ['#7a4b25', '#5a3a1a', '#9c6b3a'], { speed: [0.6, 2], g: 8, size: [0.02, 0.05], life: [0.3, 0.6] })
          this.emit(at.setY(0.5), 6, ['#fff7c2', '#ffffff'], { speed: [0.3, 0.9], g: -0.4, size: [0.02, 0.03] })
          break
        case 'dig':
          toWorld(e.x, e.y, at)
          this.emit(at, 16, ['#7a4b25', '#5a3a1a'], { speed: [0.8, 2.4], g: 9, size: [0.03, 0.06], life: [0.3, 0.6] })
          break
        case 'plantLost':
          toWorld(e.x, e.y, at)
          this.emit(at.setY(0.4), 16, ['#4caf3a', '#3f8f2f', '#8fd36a'], { speed: [0.8, 2.6], g: 7, size: [0.03, 0.06], life: [0.4, 0.8] })
          break
        case 'chomp':
          toWorld(e.x, e.y, at)
          this.emit(at, 2, ['#ffe14d', '#fff3b0'], { speed: [0.8, 2], g: 3, size: [0.02, 0.03], life: [0.12, 0.25] })
          break
        case 'crush':
          toWorld(e.x, e.y, at)
          this.emit(at, 20, ['#7a4b25', '#4caf3a', '#5a3a1a'], { speed: [1, 3], g: 9, size: [0.03, 0.07], life: [0.4, 0.8] })
          this.shake = Math.max(this.shake, 0.06)
          break
        case 'armed':
          toWorld(e.x, e.y, at)
          this.emit(at.setY(0.5), 8, ['#ff4d4d', '#ffd1d1'], { speed: [0.4, 1.2], g: 0, size: [0.02, 0.04], life: [0.3, 0.6] })
          break
        case 'collect':
          toWorld(e.x, Math.max(e.y, BOARD.y + 10), at)
          this.popup(at.setY(at.y + 0.5), `+${e.value}`)
          break
        case 'cart':
          this.shake = Math.max(this.shake, 0.05)
          break
        case 'jump':
          toWorld(e.x, e.y, at)
          this.emit(at, 10, ['#c9b48a', '#a8916a'], { speed: [0.4, 1.4], up: 0.5, g: 3, size: [0.04, 0.07], life: [0.3, 0.5] })
          break
        case 'summon':
          toWorld(e.x, e.y, at)
          this.emit(at.setY(0.5), 26, ['#b36bff', '#ff4d6d', '#ffd1dc'], { speed: [0.8, 2.6], g: 0, size: [0.03, 0.06], life: [0.4, 0.8] })
          break
        case 'laser':
          toWorld(e.x, e.y, at)
          this.emit(at, 30, ['#ff4d6d', '#ffd1dc', '#ffffff'], { speed: [1, 3.6], g: 2, size: [0.03, 0.07], life: [0.3, 0.7] })
          this.flash = Math.max(this.flash, 0.25)
          this.shake = Math.max(this.shake, 0.08)
          break
        case 'won':
          for (let i = 0; i < 8; i++) this.emit(new Vector3(-4 + Math.random() * 8, 1.5 + Math.random(), -2 + Math.random() * 3), 24, ['#ffe14d', '#8fd36a', '#ff9cc9', '#4fc3f7', '#ffffff'], { speed: [1.4, 3.6], g: 4, life: [1, 2], size: [0.04, 0.08] })
          break
        case 'lost':
          this.shake = 0.2
          break
        default:
          break
      }
    }
  }

  /** Moves effects on (only while the game runs). */
  update(dt: number) {
    this.time += dt
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 0.4)
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.5)
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i]!
      if (!p.on) continue
      p.life -= dt
      if (p.life <= 0) {
        p.on = false
        this.m4.makeScale(0, 0, 0)
        this.partMesh.setMatrixAt(i, this.m4)
        continue
      }
      p.v.y -= p.g * dt
      p.p.addScaledVector(p.v, dt)
      if (p.p.y < 0.05) {
        p.p.y = 0.05
        p.v.multiplyScalar(0.5)
        p.v.y = Math.abs(p.v.y) * 0.3
      }
      const s = p.size * Math.min(1, (p.life / p.max) * 2)
      this.m4.compose(p.p, this.q, this.v.set(s, s, s))
      this.partMesh.setMatrixAt(i, this.m4)
    }
    this.partMesh.instanceMatrix.needsUpdate = true
    for (const r of this.rings) {
      if (r.t <= 0) continue
      r.t -= dt
      r.mesh.scale.multiplyScalar(1 + dt * 1.5)
      ;(r.mesh.material as MeshBasicMaterial).opacity = Math.max(0, r.t / 0.5) * 0.8
      if (r.t <= 0) r.mesh.visible = false
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!
      p.t += dt
      if (p.t > 1.1) {
        p.el.remove()
        this.popups.splice(i, 1)
      }
    }
    if (this.rain) {
      for (let i = 0; i < this.rainDrops.length; i++) {
        const d = this.rainDrops[i]!
        d.y -= dt * 9
        d.x -= dt * 1.2
        if (d.y < 0) {
          d.y = 7 + Math.random()
          d.x = -8 + Math.random() * 16
        }
        this.m4.makeRotationZ(0.13)
        this.m4.setPosition(d)
        this.rain.setMatrixAt(i, this.m4)
      }
      this.rain.instanceMatrix.needsUpdate = true
      this.lightningT -= dt
      if (this.lightningT <= 0) {
        this.lightning = 0.5
        this.lightningT = 10 + Math.random() * 8
      }
      if (this.lightning > 0) this.lightning -= dt
    }
    if (this.fog && !this.reducedMotion) this.fog.position.x = Math.sin(this.time * 0.35) * 0.14
  }

  /* ------------------------------ Every frame ------------------------------ */

  render(engine: Engine, ui: BoardUi) {
    for (const l of this.labels.values()) l.seen = false
    this.syncPlants(engine)
    this.syncRobots(engine)
    this.syncShots(engine)
    this.syncDews(engine)
    this.syncCarts(engine)
    this.syncPlacement(engine, ui)
    this.syncLaser(engine)

    if (this.lightning > 0) this.hemi.intensity = 1.2 + this.lightning * 3
    else if (this.level.rain) this.hemi.intensity = 1.2

    const sh = this.reducedMotion ? 0 : this.shake
    this.root.position.set(sh ? (Math.random() - 0.5) * sh : 0, 0, sh ? (Math.random() - 0.5) * sh : 0)
    this.renderer.render(this.scene, this.camera)
    if (this.time - this.lastStats > 1) {
      this.lastStats = this.time
      this.canvas.dataset.drawCalls = String(this.renderer.info.render.calls)
    }
    this.flashEl.style.opacity = String(this.flash * 0.6)

    for (const p of this.popups) {
      const s = this.screenOf(p.p)
      p.el.style.transform = `translate(${s.x}px, ${s.y - p.t * 46}px) translate(-50%, -50%)`
      p.el.style.opacity = String(Math.max(0, 1 - Math.max(0, p.t - 0.6) / 0.5))
    }
    for (const [key, l] of this.labels) {
      if (!l.seen) {
        l.el.remove()
        this.labels.delete(key)
      }
    }
  }

  private label(key: string, at: Vector3, html: string, cls: string) {
    if (this.scenic) return
    let l = this.labels.get(key)
    if (!l) {
      const el = document.createElement('div')
      this.overlay.appendChild(el)
      l = { el, html: '', seen: true }
      this.labels.set(key, l)
    }
    l.seen = true
    if (l.html !== html) {
      l.el.innerHTML = html
      l.html = html
    }
    if (l.el.className !== cls) l.el.className = cls
    const s = this.screenOf(at)
    l.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%)`
  }

  private syncPlants(engine: Engine) {
    const seen = new Set<number>()
    for (const p of engine.plants) {
      seen.add(p.id)
      const role = PLANTS[p.type].role
      const name: ModelName = role === 'mine' && !p.armed ? 'coconutSleep' : p.type
      let v = this.plants.get(p.id)
      if (v && v.name !== name) {
        this.root.remove(v.obj)
        v = undefined
      }
      if (!v) {
        const obj = makeModel(name)
        obj.rotation.y = -0.55
        obj.scale.setScalar(1.15)
        this.root.add(obj)
        v = { obj, pose: obj.getObjectByName('pose')!, name, light: obj.getObjectByName('light') ?? null }
        this.plants.set(p.id, v)
      }
      v.obj.position.set(wx(p.x), 0.04, rowZ(p.r))
      let sc = 1
      if (p.t < 0.3) {
        const u = p.t / 0.3
        sc = 0.55 + 0.45 * u + 0.28 * Math.sin(u * Math.PI)
      }
      const bob = this.reducedMotion ? 0 : Math.sin(p.t * 3 + p.c) * 0.035
      let sx = sc * (1 - bob * 0.5)
      let sy = sc * (1 + bob)
      let dx = 0
      if (p.recoil > 0) {
        dx = (-p.recoil / 0.12) * 0.07
        sx *= 1.06
        sy *= 0.95
      }
      if (role === 'bomb') {
        const u = 1 - p.fuse
        sx *= 1 + u * 0.35
        sy *= 1 + u * 0.35
        dx += Math.sin(this.time * 60) * u * 0.04
      }
      if (role === 'spikes' && p.timer < 0.15) sy *= 1.25
      if (p.flash > 0) {
        sx *= 1.08
        sy *= 0.94
      }
      if (role === 'wall' && p.hp < p.max * 0.5) sy *= 0.9 + (p.hp / p.max) * 0.2
      v.pose.scale.set(sx, sy, sx)
      v.pose.position.x = dx
      if (v.light) v.light.visible = Math.sin(this.time * 8) > 0
      if (role === 'wall' && p.hp < p.max) {
        this.label(`p${p.id}`, new Vector3(wx(p.x), 1.15, rowZ(p.r)), `<span style="width:${(Math.max(0, p.hp / p.max) * 100).toFixed(0)}%"></span>`, 'lv-hp wall')
      }
    }
    for (const [id, v] of this.plants) {
      if (!seen.has(id)) {
        this.root.remove(v.obj)
        this.plants.delete(id)
      }
    }
  }

  private syncRobots(engine: Engine) {
    const seen = new Set<number>()
    const all = engine.robots.flat()
    if (engine.boss && !all.includes(engine.boss)) all.push(engine.boss)
    for (const rb of all) {
      seen.add(rb.id)
      const name = rb.sprite as ModelName
      let v = this.robots.get(rb.id)
      if (v && v.name !== name) {
        this.root.remove(v.obj)
        v = undefined
      }
      if (!v) {
        const obj = makeModel(name)
        obj.rotation.y = 0.45
        obj.scale.setScalar(rb.type === 'boss' ? 1.25 : rb.type === 'tank' ? 1.2 : 1.1)
        const aura = new Mesh(geo.sphere(0.45, 14, 10), this.auraMat)
        aura.position.y = 0.5
        aura.scale.set(0.9, 1.2, 0.9)
        aura.visible = false
        obj.add(aura)
        this.root.add(obj)
        v = { obj, pose: obj.getObjectByName('pose')!, name, aura }
        this.robots.set(rb.id, v)
      }
      const def = ROBOTS[rb.type]
      const walking = !rb.eating && !rb.dying && rb.jumpT <= 0 && rb.pause <= 0
      const still = this.reducedMotion
      let bob = walking && !still ? Math.abs(Math.sin(rb.t * 5 * (rb.slow > 0 ? 0.5 : 1))) * 0.05 : 0
      let tilt = walking && !still ? Math.sin(rb.t * 2.5) * 0.06 : rb.eating ? Math.sin(rb.t * 30) * 0.05 : 0
      let fade = 1
      if (rb.dying) {
        const total = rb.type === 'boss' ? 1.4 : 0.55
        const u = 1 - rb.dying / total
        tilt = u * (rb.type === 'boss' ? 0.4 : 1.4)
        fade = 1 - u
      }
      let lift = rb.lift / 100
      if (def.flying) lift = 0.9 + Math.sin(rb.t * 4) * 0.06
      if (rb.type === 'boss') bob = Math.sin(rb.t * 2) * 0.04
      v.obj.position.set(wx(rb.x), 0.04 + lift + bob, rowZ(rb.r))
      v.pose.rotation.z = -tilt
      v.pose.scale.setScalar(Math.max(0.01, fade) * (rb.flash > 0 ? 1.07 : 1))
      v.aura.visible = rb.slow > 0 && !rb.dying
      const rotor = v.obj.getObjectByName('rotor')
      if (rotor) rotor.rotation.y += 0.6
      const spring = v.obj.getObjectByName('spring')
      if (spring) spring.scale.y = 0.8 + Math.abs(Math.sin(rb.t * 8)) * 0.4
      if (!rb.dying && rb.type !== 'boss' && rb.hp + rb.armor < rb.max + rb.maxArmor && rb.x < LAWN_RIGHT + 60) {
        const hp = Math.max(0, rb.hp / rb.max) * 100
        const armor = rb.maxArmor ? (rb.armor / rb.maxArmor) * 100 : 0
        this.label(`r${rb.id}`, new Vector3(wx(rb.x), lift + (rb.type === 'tank' ? 1.1 : def.flying ? 0.55 : 1.25), rowZ(rb.r)), `<span style="width:${hp.toFixed(0)}%"></span>${armor > 0 ? `<i style="width:${armor.toFixed(0)}%"></i>` : ''}`, 'lv-hp')
      }
    }
    for (const [id, v] of this.robots) {
      if (!seen.has(id)) {
        this.root.remove(v.obj)
        this.robots.delete(id)
      }
    }
  }

  private syncShots(engine: Engine) {
    engine.shots.forEach((s, i) => {
      let v = this.shots[i] ?? null
      if (!s.on) {
        if (v) v.obj.visible = false
        return
      }
      if (!v || v.kind !== s.kind) {
        if (v) this.root.remove(v.obj)
        v = { obj: makeModel(s.kind), kind: s.kind }
        this.root.add(v.obj)
        this.shots[i] = v
      }
      v.obj.visible = true
      v.obj.position.set(wx(s.x), Math.max(0.1, (rowY(s.r) - s.y) / 100), rowZ(s.r))
      if (s.kind === 'leaf' || s.kind === 'seed') v.obj.rotation.y = this.time * 10
    })
  }

  private dewPos(d: Engine['dews'][number]) {
    const r = rowOf(d.ty - 30)
    return new Vector3(wx(d.x), Math.max(0, (d.ty - d.y) / 100) + 0.06, rowZ(r) + 0.2)
  }

  private syncDews(engine: Engine) {
    engine.dews.forEach((d, i) => {
      let obj = this.dews[i]
      if (!obj) {
        obj = makeModel('dew')
        obj.scale.setScalar(1.3)
        this.root.add(obj)
        this.dews[i] = obj
      }
      obj.visible = true
      const p = this.dewPos(d)
      if (d.collected) {
        const u = Math.min(1, d.ct / 0.5)
        const e = 1 - Math.pow(1 - u, 3)
        p.lerp(new Vector3(LAWN_X0 - 1.2, 2.6, LAWN_Z0 - 0.6), e)
        obj.scale.setScalar(1.3 * (1 - e * 0.6))
      }
      else {
        const pulse = this.reducedMotion ? 1 : 1 + Math.sin(d.t * 4) * 0.06
        obj.scale.setScalar(1.3 * pulse * (d.landed && d.life < 2 ? Math.max(0.2, d.life / 2) : 1))
        obj.rotation.y = d.t * 1.5
      }
      obj.position.copy(p)
    })
    for (let i = engine.dews.length; i < this.dews.length; i++) this.dews[i]!.visible = false
  }

  private syncCarts(engine: Engine) {
    engine.carts.forEach((c, r) => {
      const obj = this.carts[r]!
      obj.visible = c.state !== 'gone' && this.level.rows.includes(r)
      obj.position.x = wx(c.x)
      obj.rotation.z = c.state === 'go' && !this.reducedMotion ? Math.sin(this.time * 40) * 0.04 : 0
    })
  }

  private syncPlacement(engine: Engine, ui: BoardUi) {
    const t = ui.hover
    const show = !!t && (!!ui.seed || ui.shovel) && engine.state === 'playing'
    this.tile.visible = show
    this.lane.visible = false
    let ghostName: ModelName | null = null
    let ghostAt: Vector3 | null = null
    if (show && t) {
      const occupied = !!engine.grid[t.r]?.[t.c]
      const check = ui.seed ? engine.canPlant(ui.seed, t.r, t.c) : 'ok'
      const ok = ui.shovel ? occupied : check === 'ok' || check === 'cost'
      this.tile.position.set(wx(cellX(t.c)), 0.05, rowZ(t.r))
      ;(this.tile.material as MeshBasicMaterial).color.set(ok ? '#fff7c2' : '#ff6a5a')
      ;(this.tile.material as MeshBasicMaterial).opacity = 0.3 + Math.sin(this.time * 6) * 0.08
      if (ok && ui.seed && ['shooter', 'lobber'].includes(PLANTS[ui.seed].role)) {
        const x0 = wx(cellX(t.c)) + BOARD.cellW / 200
        const len = LAWN_X1 - x0
        if (len > 0) {
          this.lane.visible = true
          this.lane.scale.x = len
          this.lane.position.set(x0 + len / 2, 0.05, rowZ(t.r))
        }
      }
      if (ok && ui.seed && !ui.drag) {
        ghostName = ui.seed
        ghostAt = new Vector3(wx(cellX(t.c)), 0.04, rowZ(t.r))
      }
    }
    if (ui.drag && ui.seed) {
      ghostName = ui.seed
      ghostAt = new Vector3(wx(ui.drag.x), 0.25, (ui.drag.y - BOARD.height / 2) / 100)
    }
    if (ghostName && ghostAt) {
      if (!this.ghost || this.ghost.name !== ghostName) {
        if (this.ghost) this.root.remove(this.ghost.obj)
        const obj = makeModel(ghostName)
        obj.traverse((o) => {
          const m = o as Mesh
          if (m.isMesh) {
            m.material = this.ghostMat as Material
            m.castShadow = false
          }
        })
        obj.rotation.y = -0.55
        obj.scale.setScalar(1.15)
        this.root.add(obj)
        this.ghost = { obj, name: ghostName }
      }
      this.ghost.obj.visible = true
      this.ghost.obj.position.copy(ghostAt)
    }
    else if (this.ghost) this.ghost.obj.visible = false
  }

  private syncLaser(engine: Engine) {
    const boss = engine.boss
    if (!boss || boss.laserWarn <= 0 || !boss.laserTarget) {
      this.laser.visible = false
      this.laserRing.visible = false
      return
    }
    const from = new Vector3(wx(boss.x) - 0.4, 2.2 + boss.lift / 100, rowZ(boss.r))
    const to = new Vector3(wx(boss.laserTarget.x), 0.4, rowZ(boss.laserTarget.r))
    const mid = from.clone().add(to).multiplyScalar(0.5)
    const dir = to.clone().sub(from)
    this.laser.visible = true
    this.laser.position.copy(mid)
    this.laser.scale.set(1, dir.length(), 1)
    this.laser.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize())
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 30)
    ;(this.laser.material as MeshBasicMaterial).opacity = 0.35 + pulse * 0.5
    this.laserRing.visible = true
    this.laserRing.position.set(to.x, 0.07, to.z)
    this.laserRing.scale.setScalar(1 + pulse * 0.3)
  }

  dispose() {
    for (const l of this.labels.values()) l.el.remove()
    for (const p of this.popups) p.el.remove()
    this.flashEl.remove()
    this.labels.clear()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}

function shadeHex(hex: string, amount: number) {
  const n = Number.parseInt(hex.slice(1), 16)
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount)))
  return `#${[f(n >> 16), f((n >> 8) & 255), f(n & 255)].map(v => v.toString(16).padStart(2, '0')).join('')}`
}

/** Every model the interface shows as a picture. */
export const ICON_MODELS: ModelName[] = [
  'bulb', 'moonbulb', 'chili', 'twin', 'mint', 'bamboo', 'lotus', 'pumpkin', 'sugarpalm', 'corn', 'coconut', 'durian',
  'bot', 'brute', 'mini', 'drone', 'pogo', 'shield', 'tank', 'boss', 'dew', 'dara', 'yay', 'mealea', 'cart',
]
