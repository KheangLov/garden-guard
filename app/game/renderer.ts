/**
 * Draws the board on a canvas. Built for speed on phones:
 * - every sprite is drawn once (per screen size) into a bitmap, plus a white "hit" copy and an icy
 *   blue copy, and those bitmaps are copied each frame;
 * - the lawn, rubble and decorations are one bitmap drawn once per level; fog is another;
 * - particles live in a fixed ring buffer and rain in a fixed array (no garbage while playing);
 * - the canvas has no alpha channel and at most ~2.4 million pixels.
 * It never changes the game: it reads the engine's state and reacts to its events with effects.
 */
import {
  BOARD, LAWN_RIGHT, PLANTS, ROBOTS, SPRITES, WORLDS, cellX, rowY,
  type Engine, type GameEvent, type LevelDef, type PlantId, type SpriteName, type SpriteOp,
} from '#shared/game'

const TAU = Math.PI * 2
const W = BOARD.width
const H = BOARD.height
const MAX_PIXELS = 2_400_000

interface Bitmap { img: HTMLCanvasElement, flash: HTMLCanvasElement, ice: HTMLCanvasElement, w: number, h: number, pad: number }
interface Compiled { path: Path2D, fill: string | null, stroke: string | null, lw: number, alpha: number }
interface Particle { on: boolean, x: number, y: number, vx: number, vy: number, life: number, max: number, size: number, color: string, g: number, shape: 0 | 1 | 2, rot: number, vr: number }
interface Popup { x: number, y: number, t: number, text: string, color: string }

export interface BoardUi {
  /** Tile under the pointer. */
  hover: { r: number, c: number } | null
  /** The seed being planted, if any. */
  seed: PlantId | null
  shovel: boolean
  /** Where a dragged seed is (board units), to draw it under the finger. */
  drag: { x: number, y: number } | null
}

const compiled = new Map<SpriteName, Compiled[]>()
function compile(name: SpriteName): Compiled[] {
  let ops = compiled.get(name)
  if (ops) return ops
  ops = (SPRITES[name].ops as SpriteOp[]).map((op) => {
    const path = new Path2D()
    let i: number
    switch (op[0]) {
      case 'p':
        path.addPath(new Path2D(op[1]))
        i = 2
        break
      case 'c':
        path.arc(op[1], op[2], op[3], 0, TAU)
        i = 4
        break
      case 'e':
        path.ellipse(op[1], op[2], op[3], op[4], 0, 0, TAU)
        i = 5
        break
      case 'r': {
        const [, x, y, w, h, r] = op
        if (r <= 0) path.rect(x, y, w, h)
        else {
          path.moveTo(x + r, y)
          path.arcTo(x + w, y, x + w, y + h, r)
          path.arcTo(x + w, y + h, x, y + h, r)
          path.arcTo(x, y + h, x, y, r)
          path.arcTo(x, y, x + w, y, r)
          path.closePath()
        }
        i = 6
        break
      }
    }
    const style = op.slice(i) as [string | null, string | null | undefined, number | undefined, number | undefined]
    return { path, fill: style[0], stroke: style[1] ?? null, lw: style[2] ?? 1, alpha: style[3] ?? 1 }
  })
  compiled.set(name, ops)
  return ops
}

function canvasOf(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(w))
  c.height = Math.max(1, Math.ceil(h))
  return c
}

function tint(src: HTMLCanvasElement, color: string, alpha: number) {
  const c = canvasOf(src.width, src.height)
  const g = c.getContext('2d')!
  g.drawImage(src, 0, 0)
  g.globalCompositeOperation = 'source-atop'
  g.globalAlpha = alpha
  g.fillStyle = color
  g.fillRect(0, 0, c.width, c.height)
  return c
}

function seeded(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

export class Renderer {
  private ctx: CanvasRenderingContext2D
  private K = 1
  private sprites = new Map<SpriteName, Bitmap>()
  private bg: HTMLCanvasElement | null = null
  private fog: HTMLCanvasElement | null = null
  private glow: HTMLCanvasElement | null = null
  private parts: Particle[] = Array.from({ length: 700 }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, color: '#fff', g: 0, shape: 0, rot: 0, vr: 0 }))
  private pi = 0
  private popups: Popup[] = []
  private rain: { x: number, y: number, s: number }[] = []
  private shake = 0
  private flash = 0
  private lightning = 0
  private lightningT = 8
  private time = 0
  reducedMotion = false

  constructor(private canvas: HTMLCanvasElement, private level: LevelDef) {
    this.ctx = canvas.getContext('2d', { alpha: false })!
    if (level.rain) this.rain = Array.from({ length: 140 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: rand(520, 760) }))
  }

  /** Fits the canvas to its box (CSS pixels) at the screen's sharpness, within the pixel budget. */
  resize(cssWidth: number, cssHeight: number, dpr: number) {
    const scale = Math.min(cssWidth / W, cssHeight / H)
    let K = scale * Math.min(dpr, 2)
    if (W * H * K * K > MAX_PIXELS) K = Math.sqrt(MAX_PIXELS / (W * H))
    if (Math.abs(K - this.K) < 0.01 && this.bg) return
    this.K = K
    this.canvas.width = Math.round(W * K)
    this.canvas.height = Math.round(H * K)
    this.sprites.clear()
    this.buildBackground()
    this.buildFog()
    this.buildGlow()
  }

  private sprite(name: SpriteName): Bitmap {
    let s = this.sprites.get(name)
    if (s) return s
    const def = SPRITES[name]
    const pad = 4
    const K = this.K
    const img = canvasOf((def.w + pad * 2) * K, (def.h + pad * 2) * K)
    const g = img.getContext('2d')!
    g.scale(K, K)
    g.translate(pad, pad)
    g.scale(def.w / def.vw, def.h / def.vh)
    g.lineCap = 'round'
    g.lineJoin = 'round'
    for (const o of compile(name)) {
      g.globalAlpha = o.alpha
      if (o.fill) {
        g.fillStyle = o.fill
        g.fill(o.path)
      }
      if (o.stroke) {
        g.strokeStyle = o.stroke
        g.lineWidth = o.lw
        g.stroke(o.path)
      }
    }
    s = { img, flash: tint(img, '#ffffff', 0.8), ice: tint(img, '#7fd8ff', 0.42), w: def.w + pad * 2, h: def.h + pad * 2, pad }
    this.sprites.set(name, s)
    return s
  }

  /** Draws a sprite standing on (x, y). */
  private draw(name: SpriteName, x: number, y: number, sx = 1, sy = 1, rot = 0, variant: 'img' | 'flash' | 'ice' = 'img', alpha = 1) {
    const s = this.sprite(name)
    const ctx = this.ctx
    if (alpha <= 0) return
    if (!rot && sx === 1 && sy === 1) {
      ctx.globalAlpha = alpha
      ctx.drawImage(s[variant], x - s.w / 2, y - s.h + s.pad, s.w, s.h)
      ctx.globalAlpha = 1
      return
    }
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(x, y)
    if (rot) ctx.rotate(rot)
    ctx.scale(sx, sy)
    ctx.drawImage(s[variant], -s.w / 2, -s.h + s.pad, s.w, s.h)
    ctx.restore()
  }

  private buildBackground() {
    const K = this.K
    const L = this.level
    const world = WORLDS[L.world]!
    const p = world.palette
    const bg = canvasOf(W * K, H * K)
    const g = bg.getContext('2d')!
    g.scale(K, K)
    const R = seeded(L.n * 101 + 7)
    const lawnW = BOARD.cellW * BOARD.cols
    const lawnH = BOARD.cellH * BOARD.rows

    g.fillStyle = p.patio
    g.fillRect(0, 0, W, H)
    // Patio stones.
    g.strokeStyle = p.patioLine
    g.lineWidth = 2
    for (let y = 0; y < H; y += 46) {
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(BOARD.x, y)
      g.stroke()
      for (let x = (y / 46) % 2 ? 27 : 0; x < BOARD.x; x += 54) {
        g.beginPath()
        g.moveTo(x, y)
        g.lineTo(x, y + 46)
        g.stroke()
      }
    }
    g.fillStyle = p.patioLine
    g.fillRect(BOARD.x - 6, 0, 6, H)

    // Lawn: dark soil around, then the tiles (inactive rows stay soil).
    g.fillStyle = shade(p.grassB, -0.35)
    g.fillRect(BOARD.x, 0, lawnW, H)
    for (let r = 0; r < BOARD.rows; r++) {
      for (let c = 0; c < BOARD.cols; c++) {
        const x = BOARD.x + c * BOARD.cellW
        const y = BOARD.y + r * BOARD.cellH
        if (!L.rows.includes(r)) {
          g.fillStyle = shade('#7a5a3a', (R() - 0.5) * 0.08)
          g.fillRect(x, y, BOARD.cellW, BOARD.cellH)
          continue
        }
        g.fillStyle = shade((r + c) % 2 ? p.grassB : p.grassA, (R() - 0.5) * 0.06)
        g.fillRect(x, y, BOARD.cellW, BOARD.cellH)
      }
    }
    // Grass tufts and the world's own decorations.
    g.lineCap = 'round'
    g.strokeStyle = shade(p.grassB, -0.25)
    g.lineWidth = 2
    for (let i = 0; i < 150; i++) {
      const x = BOARD.x + R() * lawnW
      const y = BOARD.y + 8 + R() * (lawnH - 10)
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x - 3, y - 7)
      g.moveTo(x + 3, y)
      g.lineTo(x + 4, y - 8)
      g.stroke()
    }
    for (let i = 0; i < 36; i++) {
      const x = BOARD.x + 10 + R() * (lawnW - 20)
      const y = BOARD.y + 10 + R() * (lawnH - 20)
      switch (world.decor) {
        case 'flowers': {
          const col = ['#ffffff', '#ffb3d1', '#fff07a', '#c8b6ff'][(R() * 4) | 0]!
          g.fillStyle = col
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * TAU
            g.beginPath()
            g.arc(x + Math.cos(a) * 3.2, y + Math.sin(a) * 3.2, 2.6, 0, TAU)
            g.fill()
          }
          g.fillStyle = '#f2a20c'
          g.beginPath()
          g.arc(x, y, 2, 0, TAU)
          g.fill()
          break
        }
        case 'fireflies':
        case 'bolts':
          g.fillStyle = world.decor === 'bolts' ? 'rgba(160,160,175,.55)' : 'rgba(120,140,170,.35)'
          g.beginPath()
          g.ellipse(x, y, 3 + R() * 3, 2 + R() * 2, 0, 0, TAU)
          g.fill()
          break
        case 'rice':
          g.strokeStyle = '#d8c25a'
          g.lineWidth = 2
          g.beginPath()
          g.moveTo(x, y)
          g.quadraticCurveTo(x + 2, y - 10, x + 7, y - 14)
          g.moveTo(x + 3, y)
          g.quadraticCurveTo(x + 4, y - 8, x + 1, y - 13)
          g.stroke()
          break
        case 'stones':
          g.fillStyle = 'rgba(150,140,120,.55)'
          g.beginPath()
          g.roundRect(x, y, 10 + R() * 8, 6 + R() * 4, 2)
          g.fill()
          break
        case 'reeds':
          g.strokeStyle = '#3f7a4a'
          g.lineWidth = 2
          g.beginPath()
          g.moveTo(x, y)
          g.lineTo(x - 2, y - 14)
          g.moveTo(x + 3, y)
          g.lineTo(x + 5, y - 12)
          g.stroke()
          break
      }
    }
    // Rubble on blocked tiles.
    for (const [r, c] of L.blocked) {
      const s = this.sprite('rubble')
      g.drawImage(s.img, cellX(c) - s.w / 2, rowY(r) - s.h + s.pad + 6, s.w, s.h)
    }
    // Light: top edge shade, warm sun by day, cool vignette by night.
    let gr = g.createLinearGradient(0, BOARD.y, 0, BOARD.y + 28)
    gr.addColorStop(0, 'rgba(0,0,0,.25)')
    gr.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = gr
    g.fillRect(BOARD.x, BOARD.y, lawnW, 28)
    if (world.night) {
      gr = g.createRadialGradient(W * 0.45, H * 0.4, 120, W * 0.45, H * 0.4, W * 0.75)
      gr.addColorStop(0, 'rgba(20,20,60,0)')
      gr.addColorStop(1, 'rgba(8,8,30,.55)')
    }
    else {
      gr = g.createRadialGradient(380, 120, 40, 380, 120, 820)
      gr.addColorStop(0, 'rgba(255,248,200,.22)')
      gr.addColorStop(1, 'rgba(255,248,200,0)')
    }
    g.fillStyle = gr
    g.fillRect(0, 0, W, H)

    // The road the robots come down.
    g.fillStyle = p.road
    g.fillRect(LAWN_RIGHT, 0, W - LAWN_RIGHT, H)
    g.fillStyle = p.edge
    g.fillRect(LAWN_RIGHT, 0, 8, H)
    g.fillStyle = world.night ? 'rgba(242,209,76,.55)' : '#f2d14c'
    for (let y = 10; y < H; y += 76) g.fillRect(LAWN_RIGHT + 64, y, 7, 40)
    this.bg = bg
  }

  private buildFog() {
    this.fog = null
    const cols = this.level.fogCols
    if (!cols) return
    const K = this.K
    const w = cols * BOARD.cellW + (W - LAWN_RIGHT) + 60
    const c = canvasOf(w * K, H * K)
    const g = c.getContext('2d')!
    g.scale(K, K)
    const gr = g.createLinearGradient(0, 0, 70, 0)
    gr.addColorStop(0, 'rgba(225,232,236,0)')
    gr.addColorStop(1, 'rgba(225,232,236,.93)')
    g.fillStyle = gr
    g.fillRect(0, 0, 70, H)
    g.fillStyle = 'rgba(225,232,236,.93)'
    g.fillRect(70, 0, w - 70, H)
    const R = seeded(this.level.n + 3)
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(255,255,255,${0.15 + R() * 0.2})`
      g.beginPath()
      g.ellipse(20 + R() * w, R() * H, 40 + R() * 60, 20 + R() * 30, 0, 0, TAU)
      g.fill()
    }
    this.fog = c
  }

  private buildGlow() {
    const K = this.K
    const size = 160
    const c = canvasOf(size * K, size * K)
    const g = c.getContext('2d')!
    g.scale(K, K)
    const gr = g.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2)
    gr.addColorStop(0, 'rgba(255,240,170,.55)')
    gr.addColorStop(1, 'rgba(255,240,170,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, size, size)
    this.glow = c
  }

  /* ------------------------------ Effects ------------------------------ */

  private emit(x: number, y: number, n: number, o: { colors: string[], s0?: number, s1?: number, a0?: number, a1?: number, l0?: number, l1?: number, z0?: number, z1?: number, g?: number, shape?: 0 | 1 }) {
    if (this.reducedMotion) n = Math.ceil(n / 3)
    for (let k = 0; k < n; k++) {
      const p = this.parts[this.pi]!
      this.pi = (this.pi + 1) % this.parts.length
      const a = rand(o.a0 ?? 0, o.a1 ?? TAU)
      const s = rand(o.s0 ?? 60, o.s1 ?? 220)
      p.on = true
      p.x = x
      p.y = y
      p.vx = Math.cos(a) * s
      p.vy = Math.sin(a) * s
      p.max = p.life = rand(o.l0 ?? 0.3, o.l1 ?? 0.7)
      p.size = rand(o.z0 ?? 3, o.z1 ?? 6)
      p.color = o.colors[(Math.random() * o.colors.length) | 0]!
      p.g = o.g ?? 500
      p.shape = o.shape ?? 0
      p.rot = rand(0, TAU)
      p.vr = rand(-10, 10)
    }
  }

  private ring(x: number, y: number, r: number, color: string) {
    const p = this.parts[this.pi]!
    this.pi = (this.pi + 1) % this.parts.length
    Object.assign(p, { on: true, x, y, vx: 0, vy: 0, max: 0.45, life: 0.45, size: r, color, g: 0, shape: 2, rot: 0, vr: 0 })
  }

  private popup(x: number, y: number, text: string, color = '#fff7e0') {
    this.popups.push({ x, y, t: 0, text, color })
  }

  /** Effects for what just happened in the game. */
  handle(events: GameEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case 'shoot':
          this.emit(e.x, e.y, 2, { colors: e.kind === 'frost' ? ['#e6fbff'] : e.kind === 'leaf' ? ['#c8f59a'] : ['#ffe2a8'], s0: 20, s1: 60, l0: 0.1, l1: 0.2, z0: 3, z1: 5, g: -60, shape: 1 })
          break
        case 'hit': {
          const colors = e.kind === 'frost' ? ['#bff4ff', '#ffffff'] : e.kind === 'leaf' ? ['#9be15d', '#e9ffd0'] : e.kind === 'seed' ? ['#ff9cc9', '#ffe0ef'] : e.kind === 'spike' ? ['#e8f06a'] : ['#ffcf4a', '#ff7a1a']
          this.emit(e.x, e.y, e.armor ? 4 : 3, { colors: e.armor ? ['#dfe7ef', '#ffffff', ...colors] : colors, s0: 60, s1: 180, a0: Math.PI * 0.6, a1: Math.PI * 1.4, l0: 0.15, l1: 0.35, z0: 2, z1: 4, g: 200 })
          break
        }
        case 'armorOff':
          this.emit(e.x, e.y - 20, 14, { colors: e.kind === 'pogo' ? ['#c9a227', '#8ea880'] : ['#5b6f86', '#2b3644', '#8a9bb0', '#7fa4c4'], s0: 120, s1: 320, a0: -Math.PI, a1: 0, g: 900, l0: 0.5, l1: 0.9, z0: 4, z1: 9 })
          break
        case 'kill':
          this.emit(e.x, e.y, e.robot === 'boss' ? 60 : 16, { colors: ['#9aa8b8', '#6b7785', '#c9a227', '#4a5563'], s0: 120, s1: e.robot === 'boss' ? 600 : 340, a0: -Math.PI * 0.95, a1: -Math.PI * 0.05, g: 900, l0: 0.5, l1: 1, z0: 3, z1: 7 })
          this.emit(e.x, e.y, 8, { colors: ['#ffe14d', '#fff'], s0: 80, s1: 200, l0: 0.2, l1: 0.4, z0: 2, z1: 3, g: 0, shape: 1 })
          if (e.robot === 'tank') this.shake = Math.max(this.shake, 6)
          break
        case 'explode':
          this.ring(e.x, e.y, e.radius, '#fff3b0')
          this.ring(e.x, e.y, e.radius * 0.65, e.kind === 'boss' ? '#ff4d6d' : '#ff9a1a')
          this.emit(e.x, e.y, e.kind === 'coconut' ? 22 : 40, { colors: ['#ff7a1a', '#ffcf4a', '#ff4d1a', '#fff3b0'], s0: 150, s1: e.radius * 3, l0: 0.3, l1: 0.8, z0: 4, z1: 10, g: 300, shape: 1 })
          if (e.kind === 'corn') this.emit(e.x, e.y, 26, { colors: ['#fffdf2', '#fff3c4'], s0: 200, s1: 480, a0: -Math.PI, a1: 0, l0: 0.6, l1: 1.2, z0: 5, z1: 8, g: 900, shape: 1 })
          if (e.kind === 'coconut') this.emit(e.x, e.y, 10, { colors: ['#8a5a2b', '#4e2e14', '#f5f0e0'], s0: 150, s1: 360, a0: -Math.PI, a1: 0, g: 900, l0: 0.5, l1: 0.9, z0: 4, z1: 8 })
          this.shake = Math.max(this.shake, e.kind === 'boss' ? 20 : e.kind === 'corn' ? 14 : 8)
          this.flash = Math.max(this.flash, e.kind === 'boss' ? 0.8 : 0.35)
          break
        case 'plant':
          this.emit(e.x, e.y - 8, 12, { colors: ['#7a4b25', '#5a3a1a', '#9c6b3a'], s0: 60, s1: 200, a0: -Math.PI * 0.9, a1: -Math.PI * 0.1, g: 800, l0: 0.3, l1: 0.6, z0: 2, z1: 5 })
          this.emit(e.x, e.y - 50, 6, { colors: ['#fff7c2', '#ffffff'], s0: 30, s1: 90, l0: 0.3, l1: 0.6, z0: 2, z1: 3, g: -40, shape: 1 })
          break
        case 'dig':
          this.emit(e.x, e.y - 10, 14, { colors: ['#7a4b25', '#5a3a1a'], s0: 80, s1: 240, a0: -Math.PI * 0.9, a1: -Math.PI * 0.1, g: 900, l0: 0.3, l1: 0.6, z0: 3, z1: 6 })
          break
        case 'plantLost':
          this.emit(e.x, e.y - 40, 14, { colors: ['#4caf3a', '#3f8f2f', '#8fd36a'], s0: 80, s1: 260, g: 700, l0: 0.4, l1: 0.8, z0: 3, z1: 6 })
          break
        case 'chomp':
          this.emit(e.x, e.y, 2, { colors: ['#ffe14d', '#fff3b0'], s0: 80, s1: 200, a0: Math.PI * 0.7, a1: Math.PI * 1.3, l0: 0.12, l1: 0.25, z0: 2, z1: 3, g: 300 })
          break
        case 'crush':
          this.emit(e.x, e.y - 10, 18, { colors: ['#7a4b25', '#4caf3a', '#5a3a1a'], s0: 100, s1: 300, a0: -Math.PI, a1: 0, g: 900, l0: 0.4, l1: 0.8, z0: 3, z1: 7 })
          this.shake = Math.max(this.shake, 5)
          break
        case 'armed':
          this.emit(e.x, e.y - 30, 8, { colors: ['#ff4d4d', '#ffd1d1'], s0: 40, s1: 120, l0: 0.3, l1: 0.6, z0: 2, z1: 4, g: 0, shape: 1 })
          break
        case 'collect':
          this.popup(e.x, e.y - 30, `+${e.value}`, '#bdeaff')
          break
        case 'cart':
          this.shake = Math.max(this.shake, 4)
          break
        case 'jump':
          this.emit(e.x, e.y - 4, 10, { colors: ['#c9b48a', '#a8916a'], s0: 40, s1: 140, a0: -Math.PI, a1: 0, g: 300, l0: 0.3, l1: 0.5, z0: 3, z1: 6, shape: 1 })
          break
        case 'summon':
          this.emit(e.x, e.y, 24, { colors: ['#b36bff', '#ff4d6d', '#ffd1dc'], s0: 80, s1: 260, l0: 0.4, l1: 0.8, z0: 3, z1: 6, g: 0, shape: 1 })
          break
        case 'laser':
          this.emit(e.x, e.y, 30, { colors: ['#ff4d6d', '#ffd1dc', '#ffffff'], s0: 100, s1: 360, l0: 0.3, l1: 0.7, z0: 3, z1: 7, g: 200, shape: 1 })
          this.flash = Math.max(this.flash, 0.25)
          this.shake = Math.max(this.shake, 6)
          break
        case 'won':
          for (let i = 0; i < 6; i++) this.emit(rand(200, 1000), rand(80, 300), 20, { colors: ['#ffe14d', '#8fd36a', '#ff9cc9', '#4fc3f7', '#ffffff'], s0: 100, s1: 380, l0: 1, l1: 2, z0: 4, z1: 8, g: 260 })
          break
        case 'lost':
          this.shake = 12
          break
      }
    }
  }

  /** Moves effects on (only while the game runs). */
  update(dt: number) {
    this.time += dt
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 40)
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.5)
    for (const p of this.parts) {
      if (!p.on) continue
      p.life -= dt
      if (p.life <= 0) {
        p.on = false
        continue
      }
      p.vy += p.g * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.vr * dt
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      this.popups[i]!.t += dt
      if (this.popups[i]!.t > 1) this.popups.splice(i, 1)
    }
    if (this.rain.length) {
      for (const d of this.rain) {
        d.y += d.s * dt
        d.x -= d.s * 0.18 * dt
        if (d.y > H) {
          d.y = -20
          d.x = Math.random() * (W + 100)
        }
      }
      this.lightningT -= dt
      if (this.lightningT <= 0) {
        this.lightning = 0.5
        this.lightningT = rand(10, 18)
      }
      if (this.lightning > 0) this.lightning -= dt
    }
  }

  /* ------------------------------ Drawing ------------------------------ */

  render(engine: Engine, ui: BoardUi) {
    const ctx = this.ctx
    const K = this.K
    const sh = this.reducedMotion ? 0 : this.shake
    const sx = sh ? rand(-sh, sh) : 0
    const sy = sh ? rand(-sh, sh) : 0
    ctx.setTransform(K, 0, 0, K, sx * K, sy * K)
    if (this.bg) ctx.drawImage(this.bg, -sh, -sh, W + sh * 2, H + sh * 2)
    const night = WORLDS[this.level.world]!.night

    this.drawPlacement(engine, ui)

    for (let r = 0; r < BOARD.rows; r++) {
      for (const p of engine.grid[r]!) if (p && PLANTS[p.type].role === 'spikes') this.drawPlant(p, night)
      for (const p of engine.grid[r]!) if (p && PLANTS[p.type].role !== 'spikes') this.drawPlant(p, night)
      const cart = engine.carts[r]!
      if (cart.state !== 'gone') this.draw('cart', cart.x, rowY(r) - 6, 1, 1, cart.state === 'go' ? Math.sin(this.time * 40) * 0.04 : 0)
      for (const rb of engine.robots[r]!) if (rb.type !== 'boss') this.drawRobot(rb)
    }
    if (engine.boss) this.drawRobot(engine.boss)

    for (const s of engine.shots) {
      if (!s.on) continue
      if (s.kind === 'seed') {
        this.draw('shadow', s.x, rowY(s.r) - 4, 0.3, 0.6)
        this.draw('seed', s.x, s.y + 15, 1, 1, this.time * 8)
      }
      else this.draw(s.kind, s.x, s.y + 12, 1, 1, s.kind === 'leaf' ? Math.sin(this.time * 30) * 0.1 : 0)
    }

    if (this.fog) ctx.drawImage(this.fog, LAWN_RIGHT - this.level.fogCols * BOARD.cellW - 40 + Math.sin(this.time * 0.35) * 14, 0, this.fog.width / K, H)

    // Particles: squares, dots and rings.
    for (const p of this.parts) {
      if (!p.on) continue
      const a = p.life / p.max
      ctx.globalAlpha = Math.min(1, a * 1.5)
      if (p.shape === 2) {
        ctx.strokeStyle = p.color
        ctx.lineWidth = 10 * a
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * (1 - a * 0.8), 0, TAU)
        ctx.stroke()
      }
      else if (p.shape === 1) {
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, TAU)
        ctx.fill()
      }
      else {
        ctx.fillStyle = p.color
        const s = p.size
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillRect(-s / 2, -s / 2, s, s)
        ctx.restore()
      }
    }
    ctx.globalAlpha = 1

    this.drawDews(engine)
    this.drawBossLaser(engine)

    if (this.rain.length) {
      ctx.strokeStyle = 'rgba(200,225,255,.45)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (const d of this.rain) {
        ctx.moveTo(d.x, d.y)
        ctx.lineTo(d.x - 5, d.y + 22)
      }
      ctx.stroke()
      if (this.lightning > 0) {
        ctx.fillStyle = `rgba(230,240,255,${Math.max(0, this.lightning) * 0.7})`
        ctx.fillRect(0, 0, W, H)
      }
    }

    ctx.font = '700 24px Koulen, "Kantumruy Pro Variable", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    for (const p of this.popups) {
      ctx.globalAlpha = 1 - p.t
      ctx.strokeStyle = 'rgba(10,30,20,.85)'
      ctx.lineWidth = 6
      ctx.strokeText(p.text, p.x, p.y - p.t * 40)
      ctx.fillStyle = p.color
      ctx.fillText(p.text, p.x, p.y - p.t * 40)
    }
    ctx.globalAlpha = 1

    if (ui.drag && ui.seed) this.draw(ui.seed, ui.drag.x, ui.drag.y + 40, 1, 1, 0, 'img', 0.85)
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,250,235,${this.flash * 0.6})`
      ctx.fillRect(0, 0, W, H)
    }
  }

  private drawPlacement(engine: Engine, ui: BoardUi) {
    const t = ui.hover
    if (!t || (!ui.seed && !ui.shovel) || engine.state !== 'playing') return
    const ctx = this.ctx
    const occupied = !!engine.grid[t.r]?.[t.c]
    const ok = ui.shovel ? occupied : engine.canPlant(ui.seed!, t.r, t.c) === 'ok' || engine.canPlant(ui.seed!, t.r, t.c) === 'cost'
    const x = BOARD.x + t.c * BOARD.cellW
    const y = BOARD.y + t.r * BOARD.cellH
    ctx.fillStyle = ok ? 'rgba(255,247,194,.28)' : 'rgba(232,67,47,.22)'
    ctx.beginPath()
    ctx.roundRect(x + 4, y + 4, BOARD.cellW - 8, BOARD.cellH - 8, 12)
    ctx.fill()
    ctx.setLineDash([10, 7])
    ctx.lineDashOffset = -this.time * 30
    ctx.strokeStyle = ok ? '#fff7c2' : '#ffb3a6'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.setLineDash([])
    // Where a shot from here would go: a faint lane line.
    if (ok && ui.seed && ['shooter', 'lobber'].includes(PLANTS[ui.seed].role)) {
      ctx.fillStyle = 'rgba(255,247,194,.12)'
      ctx.fillRect(x + BOARD.cellW, y + BOARD.cellH * 0.35, LAWN_RIGHT - x - BOARD.cellW, BOARD.cellH * 0.3)
    }
    if (ok && ui.seed && !ui.drag) this.draw(ui.seed, cellX(t.c), rowY(t.r), 1, 1, 0, 'img', 0.45)
  }

  private drawPlant(p: Engine['plants'][number], night: boolean) {
    const role = PLANTS[p.type].role
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
      dx = (-p.recoil / 0.12) * 7
      sx *= 1.06
      sy *= 0.95
    }
    if (role === 'bomb') {
      const u = 1 - p.fuse
      sx *= 1 + u * 0.35
      sy *= 1 + u * 0.35
      dx += Math.sin(this.time * 60) * u * 4
    }
    if (role === 'spikes' && p.timer < 0.15) sy *= 1.12
    const x = p.x + dx
    const y = p.y
    if (role !== 'spikes') this.draw('shadow', p.x, y + 4, role === 'wall' ? 1.2 : 0.9, 1)
    if (role === 'producer' && p.timer < 1.2) {
      const g = 1 - p.timer / 1.2
      this.drawGlow(p.x, y - 62, 0.6 + g * 0.5, g * 0.9)
    }
    else if (night && role === 'producer') this.drawGlow(p.x, y - 62, 0.7, 0.35)
    const name = role === 'mine' && !p.armed ? 'coconutSleep' : PLANTS[p.type].sprite
    this.draw(name, x, y, sx, sy, 0, p.flash > 0 ? 'flash' : 'img')
    if (role === 'mine' && p.armed && Math.sin(this.time * 8) > 0.3) this.drawGlow(p.x, y - 46, 0.25, 0.8)
    if (role === 'wall' && p.hp < p.max * 0.5) this.draw('crack', x, y, sx, sy, 0, 'img', p.hp < p.max * 0.25 ? 1 : 0.6)
  }

  private drawGlow(x: number, y: number, scale: number, alpha: number) {
    if (!this.glow) return
    const s = 160 * scale
    this.ctx.globalAlpha = alpha
    this.ctx.drawImage(this.glow, x - s / 2, y - s / 2, s, s)
    this.ctx.globalAlpha = 1
  }

  private drawRobot(rb: Engine['robots'][number][number]) {
    const def = ROBOTS[rb.type]
    const base = rowY(rb.r)
    const walking = !rb.eating && !rb.dying && rb.jumpT <= 0 && rb.pause <= 0
    const still = this.reducedMotion
    let bob = walking && !still ? -Math.abs(Math.sin(rb.t * 5 * (rb.slow > 0 ? 0.5 : 1))) * 4 : 0
    let rot = walking && !still ? Math.sin(rb.t * 2.5) * 0.05 : rb.eating ? Math.sin(rb.t * 30) * 0.035 : 0
    let alpha = 1
    if (rb.dying) {
      const total = rb.type === 'boss' ? 1.4 : 0.55
      const u = 1 - rb.dying / total
      rot = u * (rb.type === 'boss' ? 0.4 : 1.3)
      alpha = 1 - u
    }
    if (def.flying) bob = Math.sin(rb.t * 4) * 6
    if (rb.type === 'boss') bob = Math.sin(rb.t * 2) * 4
    const y = base + 4 + bob - rb.lift
    this.draw('shadow', rb.x, base + 4, rb.type === 'boss' ? 2.6 : rb.type === 'tank' ? 1.6 : def.flying ? 0.6 : rb.type === 'mini' ? 0.6 : 1, 1, 0, 'img', rb.lift > 30 && !def.flying ? 0.5 : 1)
    const variant = rb.flash > 0 ? 'flash' : rb.slow > 0 ? 'ice' : 'img'
    this.draw(rb.sprite, rb.x, y, 1, 1, rot, variant, alpha)
    if (!rb.dying && rb.type !== 'boss' && rb.type !== 'tank' && rb.type !== 'drone' && rb.type !== 'mini' && rb.hp < def.hp * 0.5) {
      this.draw('scorch', rb.x, y, 1, 1, rot, 'img', 0.9)
    }
    if (!rb.dying && rb.type !== 'boss' && rb.hp + rb.armor < rb.max + rb.maxArmor) {
      const ctx = this.ctx
      const bw = rb.type === 'tank' ? 80 : 54
      const top = y - SPRITES[rb.sprite].h - 6
      const bx = rb.x - bw / 2
      ctx.fillStyle = 'rgba(15,20,15,.7)'
      ctx.beginPath()
      ctx.roundRect(bx - 2, top - 2, bw + 4, 10, 4)
      ctx.fill()
      ctx.fillStyle = '#ff5a45'
      ctx.fillRect(bx, top, (bw * Math.max(0, rb.hp)) / rb.max, 6)
      if (rb.armor > 0) {
        ctx.fillStyle = '#9fc3e6'
        ctx.fillRect(bx, top, (bw * rb.armor) / rb.maxArmor, 3)
      }
    }
  }

  private drawDews(engine: Engine) {
    for (const d of engine.dews) {
      if (d.collected) {
        const u = Math.min(1, d.ct / 0.5)
        const e = 1 - Math.pow(1 - u, 3)
        const x = d.x + (24 - d.x) * e
        const y = d.y + (-30 - d.y) * e
        this.draw('dew', x, y + 24, 1 - e * 0.4, 1 - e * 0.4, 0, 'img', 1 - u * 0.4)
        continue
      }
      const alpha = d.landed && d.life < 2 ? d.life / 2 : 1
      const pulse = this.reducedMotion ? 1 : 1 + Math.sin(d.t * 4) * 0.06
      this.draw('dew', d.x, d.y + 24, (this.reducedMotion ? 1 : Math.cos(d.t * 2) * 0.25 + 0.85), pulse, 0, 'img', alpha)
    }
  }

  private drawBossLaser(engine: Engine) {
    const boss = engine.boss
    if (!boss || boss.laserWarn <= 0 || !boss.laserTarget) return
    const ctx = this.ctx
    const t = boss.laserTarget
    const from = { x: boss.x - 40, y: rowY(boss.r) - 170 - boss.lift }
    const to = { x: t.x, y: t.y - 40 }
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 30)
    ctx.strokeStyle = `rgba(255,77,109,${0.35 + pulse * 0.5})`
    ctx.lineWidth = 3 + pulse * 3
    ctx.setLineDash([14, 10])
    ctx.lineDashOffset = -this.time * 120
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = '#ff4d6d'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(to.x, to.y, 26 + pulse * 8, 0, TAU)
    ctx.stroke()
  }

  /** The tile at a point on the board, if it's on the lawn. */
  static tileAt(x: number, y: number) {
    const c = Math.floor((x - BOARD.x) / BOARD.cellW)
    const r = Math.floor((y - BOARD.y) / BOARD.cellH)
    return c >= 0 && c < BOARD.cols && r >= 0 && r < BOARD.rows ? { r, c } : null
  }
}

/** Lightens (amount > 0) or darkens a #rrggbb colour. */
function shade(hex: string, amount: number) {
  const n = Number.parseInt(hex.slice(1), 16)
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount)))
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`
}
