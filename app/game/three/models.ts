/**
 * Every 3D model in the game, built from simple shapes in code: the plants, the Bolt-Bots, the
 * garden cart, dew and shots, the house and street, decorations and the story's people. One world
 * unit is 100 board units (a lawn tile is 1.12 × 1.04). Models stand on y = 0. Plants face +x (the
 * street, where robots come from); robots face -x (the house). Plants have a "pose" child that is
 * bobbed and squashed; robots too, plus "rotor" on the drone and "spring" on the pogo.
 */
import { CatmullRomCurve3, Group, TubeGeometry, Vector3 } from 'three'
import { geo, group, mat, paint, part, rng, shadows } from './kit'

export type ModelName
  = | 'bulb' | 'moonbulb' | 'chili' | 'twin' | 'mint' | 'bamboo' | 'lotus' | 'pumpkin' | 'sugarpalm' | 'corn'
    | 'coconut' | 'coconutSleep' | 'durian'
    | 'bot' | 'brute' | 'mini' | 'drone' | 'pogo' | 'shield' | 'tank' | 'boss'
    | 'cart' | 'dew' | 'ember' | 'frost' | 'leaf' | 'seed' | 'rubble' | 'lantern'
    | 'house' | 'flower' | 'rice' | 'stone' | 'reed' | 'bolt' | 'tree' | 'bush' | 'palm'
    | 'dara' | 'yay' | 'mealea'

const PI = Math.PI
type G = Group

/* ------------------------------ Shared bits ------------------------------ */

const hazard = () => paint('hazard', 64, (g, s) => {
  g.fillStyle = '#ffc21a'
  g.fillRect(0, 0, s, s)
  g.fillStyle = '#2a2a30'
  for (let i = -s; i < s * 2; i += 22) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i + 11, 0)
    g.lineTo(i + 11 - s, s)
    g.lineTo(i - s, s)
    g.closePath()
    g.fill()
  }
})

const wood = () => paint('wood', 128, (g, s) => {
  g.fillStyle = '#a86f3e'
  g.fillRect(0, 0, s, s)
  const r = rng(3)
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = r() < 0.5 ? 'rgba(90,50,20,.35)' : 'rgba(255,220,170,.18)'
    g.lineWidth = 1 + r() * 2
    g.beginPath()
    const y = r() * s
    g.moveTo(0, y)
    g.bezierCurveTo(s * 0.3, y + r() * 6 - 3, s * 0.7, y + r() * 6 - 3, s, y)
    g.stroke()
  }
  g.fillStyle = 'rgba(60,30,10,.4)'
  for (let y = 0; y < s; y += 32) g.fillRect(0, y, s, 2)
})

const tiles = () => paint('rooftiles', 128, (g, s) => {
  g.fillStyle = '#c4532d'
  g.fillRect(0, 0, s, s)
  for (let y = 0; y < s; y += 16) {
    g.fillStyle = 'rgba(80,20,8,.35)'
    g.fillRect(0, y, s, 3)
    for (let x = (y / 16) % 2 ? 0 : 12; x < s; x += 24) {
      g.fillStyle = 'rgba(255,190,150,.12)'
      g.fillRect(x, y + 3, 20, 12)
    }
  }
})

const krama = () => paint('krama', 64, (g, s) => {
  g.fillStyle = '#d93a2b'
  g.fillRect(0, 0, s, s)
  g.fillStyle = 'rgba(255,255,255,.85)'
  for (let i = 0; i < s; i += 16) {
    g.fillRect(i, 0, 5, s)
    g.fillRect(0, i, s, 5)
  }
})

const corncob = () => paint('corncob', 64, (g, s) => {
  g.fillStyle = '#e8b81a'
  g.fillRect(0, 0, s, s)
  for (let y = 0; y < s; y += 8) {
    for (let x = (y / 8) % 2 ? 0 : 4; x < s; x += 8) {
      g.fillStyle = '#ffe066'
      g.beginPath()
      g.ellipse(x + 4, y + 4, 3.4, 3.2, 0, 0, PI * 2)
      g.fill()
    }
  }
})

/** Two cartoon eyes on the +x side of a head of radius `r` at (x, y), looking out. */
function eyes(parent: G, x: number, y: number, gap: number, r = 0.045, angry = false) {
  for (const z of [-gap, gap]) {
    part(parent, geo.sphere(r), mat('#ffffff', { rough: 0.2 }), [x, y, z], [0, 0, 0], [0.6, 1.1, 1])
    part(parent, geo.sphere(r * 0.55), mat('#1e1410', { rough: 0.2 }), [x + r * 0.35, y - r * 0.05, z * 1.05])
    part(parent, geo.sphere(r * 0.2), mat('#ffffff'), [x + r * 0.55, y + r * 0.2, z * 1.08])
    if (angry) part(parent, geo.box(0.02, 0.02, r * 2), mat('#3a1408'), [x + 0.01, y + r * 1.3, z], [z > 0 ? -0.5 : 0.5, 0, 0])
  }
}

function smile(parent: G, x: number, y: number, w = 0.06, color = '#5a2a10') {
  part(parent, geo.torus(w, 0.012, PI), mat(color), [x, y, 0], [0, PI / 2, PI])
}

function stem(pose: G, h = 0.4, color = '#3f8f2f') {
  part(pose, geo.cyl(0.035, 0.045, h, 10), mat(color, { rough: 0.6 }), [0, h / 2, 0])
  const leaf = mat('#4fb03f', { rough: 0.55 })
  part(pose, geo.sphere(0.12), leaf, [-0.1, 0.12, 0.06], [0.3, 0.4, 0.6], [1, 0.25, 0.5])
  part(pose, geo.sphere(0.12), leaf, [0.09, 0.16, -0.06], [-0.3, -0.4, -0.6], [1, 0.25, 0.5])
}

function muzzle(parent: G, x: number, y: number, z: number, color: string, r = 0.075) {
  part(parent, geo.cyl(r, r * 0.9, 0.18, 16), mat(color, { rough: 0.4 }), [x, y, z], [0, 0, PI / 2])
  part(parent, geo.cyl(r * 0.6, r * 0.6, 0.02, 14), mat('#3a1408'), [x + 0.09, y, z], [0, 0, PI / 2])
}

function plant(build: (pose: G) => void) {
  const root = new Group()
  const pose = group(root)
  pose.name = 'pose'
  build(pose)
  return shadows(root)
}

/* ------------------------------ Plants ------------------------------ */

const bulb = () => plant((pose) => {
  stem(pose, 0.4)
  part(pose, geo.cyl(0.11, 0.09, 0.1, 16), mat('#9aa0a6', { metal: 0.6, rough: 0.3 }), [0, 0.45, 0])
  for (let i = 0; i < 3; i++) part(pose, geo.torus(0.105, 0.012), mat('#7a8086', { metal: 0.6, rough: 0.3 }), [0, 0.42 + i * 0.03, 0], [PI / 2, 0, 0])
  const glass = group(pose, [0, 0.66, 0])
  part(glass, geo.sphere(0.22), mat('#ffe14d', { rough: 0.15, emissive: '#ffcc22', emissiveIntensity: 0.55 }), [0, 0, 0], [0, 0, 0], [1, 1.1, 1])
  part(glass, geo.sphere(0.06), mat('#ffffff', { rough: 0.1 }), [0.06, 0.12, 0.14])
  eyes(glass, 0.18, 0.03, 0.07, 0.04)
  smile(glass, 0.2, -0.07, 0.05)
})

const moonbulb = () => plant((pose) => {
  stem(pose, 0.4, '#3a7f6a')
  const moon = group(pose, [0, 0.66, 0])
  part(moon, geo.torus(0.15, 0.09, PI * 1.25), mat('#c4bcff', { rough: 0.3, emissive: '#8a7aff', emissiveIntensity: 0.45 }), [0, 0, 0], [0, PI / 2, PI * 0.4])
  eyes(moon, 0.13, -0.02, 0.06, 0.035)
  part(moon, geo.sphere(0.025), mat('#fff8d6', { emissive: '#fff8d6' }), [0.1, 0.2, 0.15])
})

const chili = () => plant((pose) => {
  stem(pose, 0.36)
  const head = group(pose, [0, 0.6, 0])
  part(head, geo.sphere(0.21), mat('#e8402f', { rough: 0.3 }), [0, 0, 0], [0, 0, -0.15], [1.2, 1, 1])
  part(head, geo.sphere(0.06), mat('#ffffff', { rough: 0.1 }), [0.02, 0.13, 0.14], [0, 0, 0], [1, 0.6, 0.6])
  muzzle(head, 0.28, -0.02, 0, '#c9311f')
  eyes(head, 0.17, 0.07, 0.08, 0.045, true)
  part(head, geo.cyl(0.02, 0.025, 0.14, 8), mat('#3f8f2f'), [-0.08, 0.22, 0], [0, 0, 0.6])
})

const twin = () => plant((pose) => {
  stem(pose, 0.36)
  const head = group(pose, [0, 0.62, 0])
  part(head, geo.sphere(0.23), mat('#ff8a1f', { rough: 0.3 }), [0, 0, 0], [0, 0, -0.1], [1.15, 1.05, 1])
  muzzle(head, 0.29, 0.06, 0.07, '#e26f0e', 0.065)
  muzzle(head, 0.29, -0.08, -0.06, '#e26f0e', 0.065)
  eyes(head, 0.18, 0.1, 0.09, 0.045, true)
  part(head, geo.cyl(0.02, 0.025, 0.14, 8), mat('#3f8f2f'), [-0.08, 0.24, 0], [0, 0, 0.6])
})

const mint = () => plant((pose) => {
  stem(pose, 0.36, '#3f8f6a')
  const head = group(pose, [0, 0.62, 0])
  part(head, geo.sphere(0.21), mat('#9fe8e8', { rough: 0.2, emissive: '#5fd0e0', emissiveIntensity: 0.15 }), [0, 0, 0], [0, 0, 0], [1.1, 1, 1])
  muzzle(head, 0.27, -0.02, 0, '#6cc8d8')
  eyes(head, 0.17, 0.07, 0.08, 0.045)
  for (let i = 0; i < 4; i++) part(head, geo.cone(0.03, 0.12, 6), mat('#e6fbff', { rough: 0.2 }), [-0.12 + i * 0.06, 0.2, (i % 2 ? 1 : -1) * 0.05], [0.3, 0, 0.4 - i * 0.2])
})

const bamboo = () => plant((pose) => {
  const green = mat('#7cc044', { rough: 0.45 })
  const ring = mat('#4f8f2a', { rough: 0.5 })
  for (const [z, h] of [[-0.09, 0.85], [0.08, 0.7]] as const) {
    part(pose, geo.cyl(0.07, 0.075, h, 14), green, [-0.04, h / 2, z])
    for (let y = 0.2; y < h; y += 0.22) part(pose, geo.torus(0.073, 0.014), ring, [-0.04, y, z], [PI / 2, 0, 0])
  }
  muzzle(pose, 0.08, 0.66, 0.08, '#8fd050', 0.07)
  eyes(pose, 0.04, 0.5, 0.045, 0.035)
  part(pose, geo.sphere(0.13), mat('#5fbf4a', { rough: 0.5 }), [-0.1, 0.92, -0.09], [0, 0, 0.7], [1.2, 0.2, 0.45])
})

const lotus = () => plant((pose) => {
  part(pose, geo.cyl(0.36, 0.36, 0.03, 26), mat('#3f9a4a', { rough: 0.5 }), [0, 0.015, 0])
  const petal = mat('#ffb6d0', { rough: 0.4 })
  const deep = mat('#ff7aa8', { rough: 0.4 })
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2
    const p = group(pose, [Math.cos(a) * 0.1, 0.12, Math.sin(a) * 0.1], [0, -a, 0])
    part(p, geo.sphere(0.12), i % 2 ? petal : deep, [0.06, 0.06, 0], [0, 0, -0.9], [1, 0.4, 0.55])
  }
  const head = group(pose, [0, 0.3, 0])
  part(head, geo.sphere(0.11), mat('#ffe8f0', { rough: 0.3 }))
  part(head, geo.sphere(0.04), mat('#ffd23f', { rough: 0.3 }), [0, 0.11, 0])
  eyes(head, 0.08, 0.02, 0.045, 0.03)
})

const pumpkin = () => plant((pose) => {
  const orange = mat('#f08a24', { rough: 0.45 })
  const dark = mat('#d8701a', { rough: 0.45 })
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2
    part(pose, geo.sphere(0.24), i % 2 ? orange : dark, [Math.cos(a) * 0.12, 0.3, Math.sin(a) * 0.12], [0, -a, 0], [0.75, 1, 1])
  }
  part(pose, geo.sphere(0.28), orange, [0, 0.3, 0], [0, 0, 0], [1, 0.95, 1])
  part(pose, geo.cyl(0.035, 0.05, 0.14, 8), mat('#5a7a2a'), [0, 0.62, 0], [0, 0, 0.3])
  eyes(pose, 0.27, 0.38, 0.09, 0.045)
  smile(pose, 0.29, 0.24, 0.07)
})

const sugarpalm = () => plant((pose) => {
  const bark = mat('#8a6a42', { rough: 0.9 })
  part(pose, geo.cyl(0.2, 0.26, 0.85, 16), bark, [0, 0.425, 0])
  for (let y = 0.12; y < 0.85; y += 0.14) part(pose, geo.torus(0.22, 0.025), mat('#6a4a2a', { rough: 0.9 }), [0, y, 0], [PI / 2, 0, 0])
  const leaf = mat('#3f9a3a', { rough: 0.6, side: 'double' })
  const fan: [number, number][] = [[0, 0]]
  for (let i = 0; i <= 12; i++) {
    const a = -1 + (i / 12) * 2
    const r = i % 2 ? 0.4 : 0.46
    fan.push([Math.sin(a) * r, Math.cos(a) * r])
  }
  for (let i = 0; i < 6; i++) {
    const f = group(pose, [0, 0.86, 0], [0, (i / 6) * PI * 2, 0])
    part(f, geo.shape('palmfan', fan, 0.01), leaf, [0, 0, 0], [-0.7 - (i % 2) * 0.4, 0, 0])
  }
  eyes(pose, 0.23, 0.6, 0.08, 0.045)
  smile(pose, 0.25, 0.47, 0.06)
})

const corn = () => plant((pose) => {
  const husk = mat('#7cc044', { rough: 0.5, side: 'double' })
  part(pose, geo.capsule(0.15, 0.4), mat('#ffffff', { rough: 0.4, map: corncob() }), [0, 0.38, 0])
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + 0.4
    const h = group(pose, [Math.cos(a) * 0.12, 0.12, Math.sin(a) * 0.12], [0, -a, 0])
    part(h, geo.sphere(0.2), husk, [0.02, 0.12, 0], [0, 0, -0.25], [0.35, 1, 0.5])
  }
  eyes(pose, 0.14, 0.5, 0.06, 0.04)
  smile(pose, 0.15, 0.38, 0.05)
})

const coconut = () => plant((pose) => {
  part(pose, geo.sphere(0.24), mat('#7a4a26', { rough: 0.8 }), [0, 0.18, 0], [0, 0, 0], [1, 0.92, 1])
  part(pose, geo.cyl(0.3, 0.3, 0.04, 20), mat('#5a3a1e', { rough: 1 }), [0, 0.02, 0])
  for (const [x, z] of [[0.12, -0.07], [0.12, 0.07], [0.2, 0]] as const) part(pose, geo.sphere(0.03), mat('#3a2410'), [x + 0.06, 0.24, z])
  part(pose, geo.cyl(0.015, 0.02, 0.16, 6), mat('#3f8f2f'), [0, 0.46, 0], [0, 0, 0.3])
  const light = group(pose, [0, 0.55, 0])
  light.name = 'light'
  part(light, geo.sphere(0.045), mat('#ff4d4d', { emissive: '#ff2020', emissiveIntensity: 1.2 }))
})

const coconutSleep = () => plant((pose) => {
  part(pose, geo.sphere(0.24), mat('#6a4a2a', { rough: 1 }), [0, 0, 0], [0, 0, 0], [1.2, 0.45, 1.2])
  for (const z of [-0.07, 0.07]) part(pose, geo.torus(0.03, 0.008, PI), mat('#3a2410'), [0.2, 0.06, z], [0, PI / 2, 0])
  part(pose, geo.cyl(0.012, 0.015, 0.1, 6), mat('#3f8f2f'), [0, 0.12, 0], [0, 0, 0.4])
})

const durian = () => plant((pose) => {
  part(pose, geo.cyl(0.4, 0.42, 0.06, 20), mat('#7a8a2a', { rough: 0.8 }), [0, 0.03, 0])
  const spike = mat('#c8c84a', { rough: 0.5 })
  const r = rng(13)
  for (let i = 0; i < 22; i++) {
    const a = r() * PI * 2
    const d = Math.sqrt(r()) * 0.34
    part(pose, geo.cone(0.045, 0.16 + r() * 0.06, 6), spike, [Math.cos(a) * d, 0.12, Math.sin(a) * d], [(r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3])
  }
  eyes(pose, 0.3, 0.1, 0.07, 0.03)
})

/* ------------------------------ Robots ------------------------------ */

const steel = () => mat('#c8d2dc', { rough: 0.35, metal: 0.35 })
const steelDark = () => mat('#7d8a98', { rough: 0.4, metal: 0.35 })

function robotBody(pose: G, opts: { eye?: string, scale?: number } = {}) {
  // Faces -x. Legs, body, arms, head with a glowing eye and an antenna.
  const s = opts.scale ?? 1
  const body = group(pose, [0, 0, 0], [0, 0, 0], s)
  for (const z of [-0.1, 0.1]) {
    part(body, geo.rbox(0.1, 0.3, 0.1, 0.03), steelDark(), [0, 0.15, z])
    part(body, geo.rbox(0.16, 0.06, 0.12, 0.03), mat('#3a4250', { metal: 0.4, rough: 0.4 }), [-0.03, 0.03, z])
  }
  part(body, geo.rbox(0.42, 0.4, 0.44, 0.08), steel(), [0, 0.5, 0])
  part(body, geo.rbox(0.02, 0.16, 0.22, 0.01), mat('#5a6674', { metal: 0.5 }), [-0.21, 0.5, 0])
  part(body, geo.sphere(0.04), mat('#ffd23f', { emissive: '#ffb000', emissiveIntensity: 0.8 }), [-0.22, 0.56, 0.06])
  for (const z of [-1, 1]) {
    part(body, geo.capsule(0.05, 0.22), steelDark(), [-0.08, 0.5, z * 0.27], [0, 0, 1.2])
    part(body, geo.sphere(0.065), mat('#3a4250', { metal: 0.4 }), [-0.22, 0.42, z * 0.27])
  }
  const head = group(body, [0, 0.8, 0])
  head.name = 'head'
  part(head, geo.rbox(0.36, 0.28, 0.36, 0.08), steel())
  part(head, geo.rbox(0.02, 0.16, 0.26, 0.02), mat('#20262e', { rough: 0.2 }), [-0.18, 0, 0])
  part(head, geo.sphere(0.06), mat(opts.eye ?? '#3fe07a', { emissive: opts.eye ?? '#3fe07a', emissiveIntensity: 1.4 }), [-0.185, 0.01, 0.06])
  part(head, geo.cyl(0.012, 0.012, 0.16, 6), steelDark(), [0.02, 0.2, 0])
  part(head, geo.sphere(0.035), mat('#ff4d4d', { emissive: '#ff2020', emissiveIntensity: 1 }), [0.02, 0.29, 0])
  return body
}

function robot(build: (pose: G) => void) {
  const root = new Group()
  const pose = group(root)
  pose.name = 'pose'
  build(pose)
  return shadows(root)
}

const bot = () => robot(pose => robotBody(pose))

const brute = () => robot((pose) => {
  const body = robotBody(pose, { eye: '#ff6a3a' })
  part(body, geo.hemi(0.21), mat('#ffffff', { rough: 0.4, metal: 0.3, map: hazard() }), [0, 0.92, 0], [0, 0, 0], [1, 0.8, 1])
  part(body, geo.cyl(0.24, 0.24, 0.03, 20), mat('#2a2a30', { metal: 0.4 }), [0, 0.92, 0])
})

const mini = () => robot((pose) => {
  part(pose, geo.sphere(0.2), mat('#f2963a', { rough: 0.3, metal: 0.3 }), [0, 0.28, 0])
  part(pose, geo.cyl(0.09, 0.09, 0.03, 18), mat('#20262e'), [-0.19, 0.3, 0], [0, 0, PI / 2])
  part(pose, geo.sphere(0.06), mat('#ffd23f', { emissive: '#ffcc00', emissiveIntensity: 1.3 }), [-0.2, 0.3, 0])
  for (const z of [-0.09, 0.09]) part(pose, geo.capsule(0.03, 0.08), steelDark(), [0, 0.06, z])
  part(pose, geo.cyl(0.01, 0.01, 0.14, 6), steelDark(), [0.02, 0.52, 0])
  part(pose, geo.sphere(0.03), mat('#7ad06a', { emissive: '#5fc04a' }), [0.02, 0.6, 0])
})

const drone = () => robot((pose) => {
  part(pose, geo.sphere(0.22), mat('#ffd23f', { rough: 0.3, metal: 0.3 }), [0, 0, 0], [0, 0, 0], [1.2, 0.7, 1])
  part(pose, geo.cyl(0.08, 0.08, 0.03, 18), mat('#20262e'), [-0.25, 0.01, 0], [0, 0, PI / 2])
  part(pose, geo.sphere(0.055), mat('#3fe07a', { emissive: '#3fe07a', emissiveIntensity: 1.4 }), [-0.26, 0.01, 0])
  part(pose, geo.cyl(0.02, 0.02, 0.14, 6), steelDark(), [0, 0.2, 0])
  const rotor = group(pose, [0, 0.28, 0])
  rotor.name = 'rotor'
  part(rotor, geo.rbox(0.7, 0.02, 0.06, 0.01), steelDark())
  part(rotor, geo.rbox(0.06, 0.02, 0.7, 0.01), steelDark())
  for (const z of [-1, 1]) part(pose, geo.cyl(0.012, 0.012, 0.2, 6), steelDark(), [0.06, -0.16, z * 0.14], [z * 0.3, 0, 0])
})

const pogo = () => robot((pose) => {
  const spring = group(pose)
  spring.name = 'spring'
  for (let i = 0; i < 5; i++) part(spring, geo.torus(0.07, 0.018), mat('#e8c84a', { metal: 0.6, rough: 0.3 }), [0, 0.05 + i * 0.05, 0], [PI / 2, 0, 0])
  part(pose, geo.cyl(0.015, 0.015, 0.8, 6), steelDark(), [0, 0.5, 0])
  const body = group(pose, [0, 0.26, 0])
  robotBody(body, { eye: '#ffb000', scale: 0.85 })
})

const shield = () => robot((pose) => {
  robotBody(pose, { eye: '#ff6a3a' })
  const sh = group(pose, [-0.3, 0.5, 0])
  part(sh, geo.rbox(0.06, 0.66, 0.44, 0.04), mat('#5a8ad0', { rough: 0.3, metal: 0.5 }))
  part(sh, geo.rbox(0.07, 0.5, 0.06, 0.02), mat('#ffc21a', { rough: 0.3, metal: 0.3 }), [0, 0, 0.12])
  part(sh, geo.rbox(0.07, 0.5, 0.06, 0.02), mat('#ffc21a', { rough: 0.3, metal: 0.3 }), [0, 0, -0.12])
})

const tank = () => robot((pose) => {
  const track = mat('#2a2e36', { rough: 0.7 })
  for (const z of [-0.26, 0.26]) {
    part(pose, geo.rbox(0.9, 0.22, 0.16, 0.08), track, [0, 0.11, z])
    for (let i = 0; i < 4; i++) part(pose, geo.cyl(0.07, 0.07, 0.17, 14), mat('#8a94a0', { metal: 0.6, rough: 0.3 }), [-0.3 + i * 0.2, 0.11, z], [PI / 2, 0, 0])
  }
  part(pose, geo.rbox(0.82, 0.24, 0.42, 0.05), mat('#8a6a4a', { rough: 0.45, metal: 0.4 }), [0, 0.32, 0])
  part(pose, geo.rbox(0.84, 0.06, 0.44, 0.02), mat('#ffffff', { rough: 0.4, metal: 0.3, map: hazard() }), [0, 0.42, 0])
  const turret = group(pose, [0.05, 0.56, 0])
  part(turret, geo.rbox(0.42, 0.22, 0.34, 0.06), mat('#9a7a58', { rough: 0.4, metal: 0.4 }))
  part(turret, geo.cyl(0.05, 0.05, 0.5, 12), steelDark(), [-0.4, 0, 0], [0, 0, PI / 2])
  part(turret, geo.rbox(0.02, 0.06, 0.16, 0.01), mat('#ff4d4d', { emissive: '#ff2020', emissiveIntensity: 1 }), [-0.21, 0.04, 0])
})

const boss = () => robot((pose) => {
  const purple = mat('#6a3a9a', { rough: 0.3, metal: 0.45 })
  const dark = mat('#3a1f54', { rough: 0.35, metal: 0.4 })
  for (const z of [-0.26, 0.26]) {
    part(pose, geo.rbox(0.3, 0.6, 0.26, 0.08), dark, [0, 0.3, z])
    part(pose, geo.rbox(0.42, 0.12, 0.3, 0.05), mat('#20142c', { metal: 0.4 }), [-0.04, 0.06, z])
  }
  part(pose, geo.rbox(0.9, 0.9, 0.9, 0.16), purple, [0, 1.05, 0])
  part(pose, geo.sphere(0.16), mat('#ff4d8a', { emissive: '#ff2a6a', emissiveIntensity: 1.6 }), [-0.42, 1.05, 0])
  part(pose, geo.torus(0.17, 0.035), mat('#ffc21a', { metal: 0.6, rough: 0.3 }), [-0.43, 1.05, 0], [0, PI / 2, 0])
  for (const z of [-1, 1]) {
    part(pose, geo.sphere(0.2), dark, [0, 1.42, z * 0.52])
    part(pose, geo.capsule(0.1, 0.5), purple, [-0.1, 1.0, z * 0.6], [0, 0, 0.5])
    part(pose, geo.sphere(0.14), dark, [-0.28, 0.72, z * 0.62])
  }
  const head = group(pose, [0, 1.72, 0])
  head.name = 'head'
  part(head, geo.rbox(0.56, 0.4, 0.56, 0.1), purple)
  part(head, geo.rbox(0.04, 0.12, 0.42, 0.03), mat('#ff4d6d', { emissive: '#ff2a4a', emissiveIntensity: 1.6 }), [-0.28, 0.02, 0])
  const gold = mat('#ffc21a', { metal: 0.7, rough: 0.25 })
  for (let i = 0; i < 5; i++) part(head, geo.cone(0.07, 0.2, 4), gold, [0, 0.28, -0.2 + i * 0.1])
})

/* ------------------------------ Garden things ------------------------------ */

function cart() {
  const root = new Group()
  const red = mat('#d8402f', { rough: 0.4, metal: 0.2 })
  part(root, geo.lathe('tray', [[0, 0], [0.22, 0], [0.32, 0.22], [0.3, 0.23], [0.2, 0.02], [0, 0.02]], 4), red, [0, 0.2, 0], [0, PI / 4, 0], [1.3, 1, 1])
  for (const z of [-0.2, 0.2]) {
    const w = group(root, [-0.05, 0.12, z], [PI / 2, 0, 0])
    part(w, geo.torus(0.09, 0.035), mat('#2a2a2e', { rough: 0.8 }))
    part(w, geo.cyl(0.05, 0.05, 0.05, 12), mat('#c8c8c8', { metal: 0.6, rough: 0.3 }), [0, 0, 0], [PI / 2, 0, 0])
  }
  for (const z of [-0.14, 0.14]) part(root, geo.cyl(0.015, 0.015, 0.5, 6), mat('#6a4026'), [-0.42, 0.4, z], [0, 0, 1.1])
  part(root, geo.cyl(0.02, 0.02, 0.32, 6), mat('#6a4026'), [-0.62, 0.5, 0], [PI / 2, 0, 0])
  return shadows(root)
}

function dew() {
  const root = new Group()
  const r = 0.12
  const h = 0.34
  const pts: [number, number][] = []
  for (let i = 0; i <= 8; i++) {
    const t = (i / 8) * (PI / 2)
    pts.push([r * Math.sin(t), r - r * Math.cos(t)])
  }
  for (let i = 1; i <= 10; i++) {
    const y = r + ((h - r) * i) / 10
    pts.push([r * (1 - (y - r) / (h - r)) ** 1.3, y])
  }
  part(root, geo.lathe('drop', pts), mat('#5fd0ff', { rough: 0.05, metal: 0.1, emissive: '#2fa8e8', emissiveIntensity: 0.35 }))
  part(root, geo.sphere(0.03), mat('#ffffff', { rough: 0.1 }), [-0.04, 0.12, 0.08], [0, 0, 0], [0.7, 1.2, 0.5])
  return shadows(root)
}

function shot(color: string, emissive: string, scale: [number, number, number] = [1, 1, 1]) {
  const root = new Group()
  part(root, geo.sphere(0.09), mat(color, { rough: 0.2, emissive, emissiveIntensity: 1.2 }), [0, 0, 0], [0, 0, 0], scale)
  return root
}

function leafShot() {
  const root = new Group()
  part(root, geo.sphere(0.14), mat('#8fd050', { rough: 0.4, emissive: '#4f9a2a', emissiveIntensity: 0.4 }), [0, 0, 0], [0, 0, 0], [1.3, 0.12, 0.45])
  part(root, geo.box(0.34, 0.012, 0.012), mat('#4f8f2a'))
  return root
}

function rubble() {
  const root = new Group()
  const r = rng(7)
  for (let i = 0; i < 6; i++) {
    part(root, geo.sphere(0.14 + r() * 0.1, 7, 5), mat(i % 2 ? '#9a948a' : '#7d776d', { rough: 0.95, flat: true }), [(r() - 0.5) * 0.6, 0.06, (r() - 0.5) * 0.5], [r(), r(), r()], [1.2, 0.7, 1])
  }
  part(root, geo.cyl(0.015, 0.02, 0.15, 6), mat('#5c8f3a'), [0.15, 0.15, 0.1], [0, 0, 0.5])
  return shadows(root)
}

function lantern() {
  const root = new Group()
  part(root, geo.cyl(0.01, 0.01, 0.3, 6), mat('#3a2a1a'), [0, 0.15, 0])
  part(root, geo.sphere(0.14), mat('#ff8a3d', { rough: 0.5, emissive: '#ff7a1a', emissiveIntensity: 1.3 }), [0, -0.12, 0], [0, 0, 0], [1, 1.2, 1])
  for (const y of [0.04, -0.29]) part(root, geo.cyl(0.07, 0.07, 0.04, 12), mat('#3a2a1a'), [0, y, 0])
  return root
}

function house() {
  const root = new Group()
  const woodMat = mat('#ffffff', { rough: 0.8, map: wood() })
  const post = mat('#6a4026', { rough: 0.85 })
  for (const x of [-0.5, 0.5]) for (const z of [-2.2, -0.8, 0.8, 2.2]) part(root, geo.cyl(0.07, 0.08, 0.9, 10), post, [x, 0.45, z])
  part(root, geo.rbox(1.3, 0.12, 5.0, 0.03), mat('#8a5a34', { rough: 0.85 }), [0, 0.95, 0])
  part(root, geo.box(1.0, 1.0, 4.6), woodMat, [-0.1, 1.5, 0])
  for (const z of [-1.6, 0, 1.6]) {
    part(root, geo.rbox(0.04, 0.4, 0.5, 0.02), mat('#3a2414', { rough: 0.6 }), [0.41, 1.6, z])
    part(root, geo.box(0.05, 0.44, 0.06), woodMat, [0.42, 1.6, z])
  }
  part(root, geo.gable(5.2, 1.6, 0.9, 0.1), mat('#ffffff', { rough: 0.7, map: tiles(), side: 'double' }), [-0.1, 1.95, 0], [0, PI / 2, 0])
  // Steps down to the patio.
  for (let i = 0; i < 4; i++) part(root, geo.box(0.16, 0.06, 0.7), post, [0.62 + i * 0.13, 0.85 - i * 0.22, 0])
  for (const z of [-2.5, 2.5]) part(root, geo.cone(0.06, 0.4, 8), mat('#7a2e18'), [-0.1, 2.88, z], [z > 0 ? 0.7 : -0.7, 0, 0])
  return shadows(root)
}

function flower() {
  const root = new Group()
  const r = rng(17)
  const colors = ['#ffffff', '#ffb3d1', '#fff07a', '#c8b6ff']
  for (let k = 0; k < 3; k++) {
    const x = (r() - 0.5) * 0.3
    const z = (r() - 0.5) * 0.3
    part(root, geo.cyl(0.008, 0.008, 0.12, 4), mat('#4caf3a'), [x, 0.06, z])
    part(root, geo.sphere(0.04, 8, 6), mat(colors[k % colors.length]!, { rough: 0.6 }), [x, 0.13, z], [0, 0, 0], [1, 0.5, 1])
    part(root, geo.sphere(0.015, 6, 4), mat('#ffd23f'), [x, 0.15, z])
  }
  return root
}

function rice() {
  const root = new Group()
  const r = rng(11)
  const green = mat('#7cc044', { rough: 0.7 })
  const gold = mat('#e8c84a', { rough: 0.6 })
  for (let i = 0; i < 9; i++) {
    const a = r() * PI * 2
    const tilt = 0.15 + r() * 0.25
    const h = 0.35 + r() * 0.2
    const blade = group(root, [Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04], [Math.sin(a) * tilt, 0, -Math.cos(a) * tilt])
    part(blade, geo.cone(0.014, h, 5), green, [0, h / 2, 0])
    if (i % 2) part(blade, geo.capsule(0.018, 0.06), gold, [0.02, h - 0.02, 0], [0, 0, 0.6])
  }
  return root
}

function stone() {
  const root = new Group()
  part(root, geo.sphere(0.16, 8, 6), mat('#a8a092', { rough: 0.95, flat: true }), [0, 0.06, 0], [0.3, 0.5, 0.2], [1.3, 0.6, 1])
  part(root, geo.sphere(0.09, 7, 5), mat('#8a8274', { rough: 0.95, flat: true }), [0.17, 0.04, 0.08], [0.6, 0.2, 0.4], [1, 0.7, 1])
  return root
}

function reed() {
  const root = new Group()
  const r = rng(19)
  for (let i = 0; i < 6; i++) {
    const h = 0.4 + r() * 0.3
    const b = group(root, [(r() - 0.5) * 0.12, 0, (r() - 0.5) * 0.12], [(r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3])
    part(b, geo.cyl(0.008, 0.012, h, 4), mat('#5a8a3a'), [0, h / 2, 0])
    if (i % 2) part(b, geo.capsule(0.025, 0.08), mat('#7a5230', { rough: 0.9 }), [0, h, 0])
  }
  return root
}

function bolt() {
  const root = new Group()
  part(root, geo.cyl(0.06, 0.06, 0.04, 6), mat('#8a94a0', { metal: 0.7, rough: 0.3 }), [0, 0.02, 0])
  part(root, geo.cyl(0.025, 0.025, 0.14, 8), mat('#a8b4c0', { metal: 0.7, rough: 0.3 }), [0.08, 0.025, 0.05], [0, 0.4, PI / 2])
  return root
}

function tree() {
  const root = new Group()
  part(root, geo.cyl(0.1, 0.14, 0.9, 10), mat('#6a4a2a', { rough: 1 }), [0, 0.45, 0])
  const leaf = mat('#3f8f3a', { rough: 0.85 })
  const light = mat('#58a84a', { rough: 0.85 })
  for (const [x, y, z, s] of [[0, 1.15, 0, 0.55], [0.32, 0.95, 0.1, 0.38], [-0.32, 0.98, -0.05, 0.4], [0.05, 1.5, 0.05, 0.38], [0, 1.0, 0.3, 0.36]] as const) {
    part(root, geo.sphere(1, 14, 10), s > 0.5 ? leaf : light, [x, y, z], [0, 0, 0], s)
  }
  return shadows(root, false)
}

function bush() {
  const root = new Group()
  const leaf = mat('#4a9a3a', { rough: 0.85 })
  const light = mat('#62b24c', { rough: 0.85 })
  for (const [x, y, z, s] of [[0, 0.2, 0, 0.3], [0.25, 0.16, 0.05, 0.22], [-0.24, 0.17, 0.02, 0.23]] as const) part(root, geo.sphere(1, 12, 9), x ? light : leaf, [x, y, z], [0, 0, 0], s)
  for (const [x, z] of [[0.05, 0.28], [-0.15, 0.22], [0.2, 0.2]] as const) part(root, geo.sphere(0.035), mat('#ff6a90', { rough: 0.5 }), [x, 0.3, z])
  return shadows(root, false)
}

function palm() {
  const root = new Group()
  const trunk = new CatmullRomCurve3([new Vector3(0, 0, 0), new Vector3(0.05, 1, 0), new Vector3(-0.02, 2, 0.02), new Vector3(0, 2.7, 0)])
  part(root, new TubeGeometry(trunk, 16, 0.09, 10), mat('#7a5a3a', { rough: 1 }))
  const leaf = mat('#3f9a3a', { rough: 0.7, side: 'double' })
  const fan: [number, number][] = [[0, 0]]
  for (let i = 0; i <= 14; i++) {
    const a = -1.1 + (i / 14) * 2.2
    const r = i % 2 ? 0.62 : 0.72
    fan.push([Math.sin(a) * r, Math.cos(a) * r])
  }
  for (let i = 0; i < 9; i++) {
    const f = group(root, [0, 2.7, 0], [0, (i / 9) * PI * 2, 0])
    part(f, geo.shape('palmfan2', fan, 0.01), leaf, [0, 0, 0], [-0.9 - (i % 3) * 0.25, 0, 0])
  }
  return shadows(root, false)
}

/* ------------------------------ People ------------------------------ */

function person(kind: 'dara' | 'yay' | 'mealea') {
  const root = new Group()
  const skin = mat(kind === 'yay' ? '#c98a5a' : '#d9a070', { rough: 0.6 })
  const shirt = { dara: '#3f8f6a', yay: '#7a4aa0', mealea: '#f08a3a' }[kind]
  part(root, geo.capsule(0.2, 0.22), mat(shirt, { rough: 0.8 }), [0, 0.32, 0], [0, 0, 0], [0.85, 1, 1.3])
  for (const z of [-1, 1]) {
    part(root, geo.capsule(0.06, 0.24), mat(shirt, { rough: 0.8 }), [0.04, 0.38, z * 0.25], [z * 0.25, 0, -0.25])
    part(root, geo.sphere(0.06), skin, [0.1, 0.22, z * 0.29])
  }
  if (kind === 'dara') part(root, geo.torus(0.1, 0.045), mat('#ffffff', { rough: 0.8, map: krama() }), [0, 0.6, 0], [PI / 2, 0, 0])
  const head = group(root, [0, 0.86, 0], [0, 0, 0], 1.12)
  part(head, geo.sphere(0.19), skin)
  for (const z of [-1, 1]) part(head, geo.sphere(0.045), skin, [-0.02, 0, z * 0.18], [0, 0, 0], [0.6, 1, 0.6])
  for (const z of [-0.07, 0.07]) {
    part(head, geo.sphere(0.024), mat('#2a1a10', { rough: 0.2 }), [0.17, 0.02, z])
    part(head, geo.sphere(0.008), mat('#ffffff'), [0.188, 0.03, z * 1.05])
    part(head, geo.sphere(0.03), mat('#ff8f7a', { rough: 0.7 }), [0.14, -0.06, z * 1.8], [0, 0, 0], [0.5, 0.6, 0.8])
  }
  part(head, geo.torus(0.05, 0.01, PI), mat('#8a3a2a'), [0.18, -0.07, 0], [0, PI / 2, PI])
  if (kind === 'dara') {
    part(head, geo.hemi(0.2), mat('#2a1a10', { rough: 0.5 }), [-0.02, 0.02, 0], [0, 0, 0.35])
    part(head, geo.cyl(0.34, 0.34, 0.02, 26), mat('#e8c870', { rough: 0.8 }), [0, 0.15, 0])
    part(head, geo.cyl(0.19, 0.2, 0.14, 22), mat('#f2d68a', { rough: 0.8 }), [0, 0.22, 0])
    part(head, geo.cyl(0.2, 0.2, 0.03, 22, true), mat('#e8402f', { side: 'double' }), [0, 0.18, 0])
  }
  if (kind === 'yay') {
    part(head, geo.hemi(0.2), mat('#ececec', { rough: 0.9 }), [-0.03, 0.03, 0], [0, 0, 0.5])
    part(head, geo.sphere(0.09), mat('#ececec', { rough: 0.9 }), [-0.16, 0.14, 0])
    for (const z of [-0.07, 0.07]) part(head, geo.torus(0.04, 0.008), mat('#5a3a20', { metal: 0.4 }), [0.18, 0.02, z], [0, PI / 2, 0])
  }
  if (kind === 'mealea') {
    part(head, geo.hemi(0.2), mat('#1a1010', { rough: 0.5 }), [-0.02, 0.02, 0], [0, 0, 0.35])
    part(head, geo.capsule(0.08, 0.3), mat('#1a1010', { rough: 0.5 }), [-0.17, -0.2, 0])
    part(head, geo.cone(0.42, 0.24, 26), mat('#e8d090', { rough: 0.8 }), [0, 0.26, 0])
  }
  return shadows(root)
}

/* ------------------------------ The catalogue ------------------------------ */

const MAKERS: Record<ModelName, () => Group> = {
  bulb, moonbulb, chili, twin, mint, bamboo, lotus, pumpkin, sugarpalm, corn, coconut, coconutSleep, durian,
  bot, brute, mini, drone, pogo, shield, tank, boss,
  cart, dew,
  ember: () => shot('#ffb040', '#ff7a1a', [1.2, 1, 1]),
  frost: () => shot('#c8f4ff', '#6fd8ff'),
  leaf: leafShot,
  seed: () => shot('#ff9cc9', '#ff6aa8', [1.1, 1.1, 1.1]),
  rubble, lantern, house, flower, rice, stone, reed, bolt, tree, bush, palm,
  dara: () => person('dara'),
  yay: () => person('yay'),
  mealea: () => person('mealea'),
}

/** A fresh copy of a model (geometry and materials are shared). */
export function makeModel(name: ModelName): Group {
  const g = MAKERS[name]()
  g.name = name
  return g
}
