/**
 * The game's rules, with no drawing and no browser: plants, robots, shots, dew, carts, waves,
 * winning and losing. The page steps it at a fixed 60 times a second and reads its state to draw;
 * what happened in a step (a shot, a hit, a wave) comes out as events, which drive the effects,
 * sounds and interface. Deterministic for a given level and seed, so tests can play whole levels.
 */
import {
  BOARD, DEW_VALUE, HIT_LIMIT_X, LAWN_RIGHT, PLANTS, ROBOTS, SHOT_SPEED, cellX, rowY,
  type PlantId, type RobotId,
} from './data'
import type { LevelDef, SpawnDef } from './levels'
import { createRng, type Rng } from './rng'
import type { SpriteName } from './sprites'

export const STEP = 1 / 60

export interface Plant {
  id: number
  type: PlantId
  r: number
  c: number
  x: number
  y: number
  hp: number
  max: number
  /** Countdown to its next shot or dew drop (or, for a mine, to being armed). */
  timer: number
  /** Age in seconds (animations). */
  t: number
  flash: number
  recoil: number
  armed: boolean
  fuse: number
  hurtT: number
  volleyLeft: number
  volleyT: number
}

export interface Robot {
  id: number
  type: RobotId
  r: number
  x: number
  /** Height above the ground line (jumps, flying, a boss changing rows). */
  lift: number
  hp: number
  max: number
  armor: number
  maxArmor: number
  slow: number
  flash: number
  t: number
  dying: number
  eating: boolean
  sprite: SpriteName
  canJump: boolean
  jumpT: number
  jumpFrom: number
  jumpTo: number
  pause: number
  chompT: number
  // Boss only.
  laneLift: number
  summonT: number
  laneT: number
  laserT: number
  laserTarget: Plant | null
  laserWarn: number
}

export type ShotKind = 'ember' | 'frost' | 'leaf' | 'seed'

export interface Shot {
  on: boolean
  kind: ShotKind
  r: number
  x: number
  y: number
  damage: number
  /** Robots a piercing leaf has already hit. */
  hits: number[]
  // Lobbed seeds.
  x0: number
  y0: number
  x1: number
  t: number
  dur: number
}

export interface Dew {
  x: number
  y: number
  vx: number
  vy: number
  g: number
  ty: number
  landed: boolean
  life: number
  collected: boolean
  ct: number
  value: number
  t: number
}

export interface Cart {
  state: 'idle' | 'go' | 'gone'
  x: number
}

export type GameEvent
  = | { type: 'shoot', x: number, y: number, kind: ShotKind }
    | { type: 'hit', x: number, y: number, kind: ShotKind | 'blast' | 'spike', armor: boolean }
    | { type: 'armorOff', x: number, y: number, kind: 'helmet' | 'shield' | 'pogo' }
    | { type: 'kill', x: number, y: number, robot: RobotId }
    | { type: 'explode', x: number, y: number, radius: number, kind: 'corn' | 'coconut' | 'boss' }
    | { type: 'plant', x: number, y: number, plant: PlantId }
    | { type: 'dig', x: number, y: number }
    | { type: 'plantLost', x: number, y: number, plant: PlantId }
    | { type: 'chomp', x: number, y: number }
    | { type: 'crush', x: number, y: number }
    | { type: 'armed', x: number, y: number }
    | { type: 'dewDrop', x: number, y: number }
    | { type: 'collect', x: number, y: number, value: number }
    | { type: 'cart', row: number }
    | { type: 'wave', wave: number, huge: boolean, final: boolean }
    | { type: 'robotIn', robot: RobotId }
    | { type: 'jump', x: number, y: number }
    | { type: 'summon', x: number, y: number }
    | { type: 'laserWarn', x: number, y: number }
    | { type: 'laser', x: number, y: number }
    | { type: 'won', stars: number }
    | { type: 'lost' }

export type PlantCheck = 'ok' | 'row' | 'blocked' | 'occupied' | 'cost' | 'cooldown' | 'banned' | 'notInLoadout'

const BOSS_STOP_X = 960

export class Engine {
  readonly level: LevelDef
  readonly loadout: PlantId[]
  state: 'playing' | 'won' | 'lost' = 'playing'
  time = 0
  dew: number
  grid: (Plant | null)[][]
  plants: Plant[] = []
  robots: Robot[][]
  readonly shots: Shot[]
  dews: Dew[] = []
  carts: Cart[]
  cooldown: Partial<Record<PlantId, number>> = {}
  /** What each seed's current recharge started at (for the card's sweep). */
  cooldownTotal: Partial<Record<PlantId, number>> = {}
  boss: Robot | null = null
  stats = { cartsUsed: 0, plantsLost: 0, robotsBeaten: 0 }
  stars = 0
  /** Waves announced so far. */
  wave = 0
  /** Collect dew by itself (a setting). */
  autoCollect = false

  private events: GameEvent[] = []
  private spawnIndex = 0
  private skyT = 5
  private nextId = 1
  private rng: Rng
  private blocked: Set<number>
  private lastSpawnT: number

  constructor(level: LevelDef, loadout: PlantId[], seed = level.n) {
    this.level = level
    this.loadout = loadout.filter(id => level.plants.includes(id))
    this.dew = level.startDew
    this.rng = createRng(seed * 31 + 7)
    this.grid = Array.from({ length: BOARD.rows }, () => Array<Plant | null>(BOARD.cols).fill(null))
    this.robots = Array.from({ length: BOARD.rows }, () => [])
    this.carts = Array.from({ length: BOARD.rows }, (_, r) => ({ state: level.rows.includes(r) ? 'idle' : 'gone', x: 52 }))
    this.shots = Array.from({ length: 220 }, () => ({ on: false, kind: 'ember', r: 0, x: 0, y: 0, damage: 0, hits: [], x0: 0, y0: 0, x1: 0, t: 0, dur: 0 }))
    this.blocked = new Set(level.blocked.map(([r, c]) => r * BOARD.cols + c))
    for (const id of this.loadout) this.cooldown[id] = this.cooldownTotal[id] = PLANTS[id].startCooldown
    this.lastSpawnT = level.spawns.length ? level.spawns[level.spawns.length - 1]!.t : 1
  }

  /** How far through the level's robots we are, 0 to 1 (the progress bar). */
  get progress() {
    if (this.state === 'won') return 1
    return Math.min(1, this.time / this.lastSpawnT)
  }

  isBlocked(r: number, c: number) {
    return this.blocked.has(r * BOARD.cols + c)
  }

  /** Takes the events since the last call. */
  drainEvents(): GameEvent[] {
    const out = this.events
    this.events = []
    return out
  }

  private emit(event: GameEvent) {
    this.events.push(event)
  }

  canPlant(type: PlantId, r: number, c: number): PlantCheck {
    if (!this.loadout.includes(type)) return 'notInLoadout'
    if (this.level.noProducers && PLANTS[type].role === 'producer') return 'banned'
    if (r < 0 || r >= BOARD.rows || c < 0 || c >= BOARD.cols || !this.level.rows.includes(r)) return 'row'
    if (this.isBlocked(r, c)) return 'blocked'
    if (this.grid[r]![c]) return 'occupied'
    if ((this.cooldown[type] ?? 0) > 0) return 'cooldown'
    if (this.dew < PLANTS[type].cost) return 'cost'
    return 'ok'
  }

  /** Whether a seed card can be used right now (ignoring where). */
  seedReady(type: PlantId) {
    return this.loadout.includes(type) && (this.cooldown[type] ?? 0) <= 0 && this.dew >= PLANTS[type].cost
      && !(this.level.noProducers && PLANTS[type].role === 'producer')
  }

  plant(type: PlantId, r: number, c: number): boolean {
    if (this.state !== 'playing' || this.canPlant(type, r, c) !== 'ok') return false
    const def = PLANTS[type]
    this.dew -= def.cost
    this.cooldown[type] = this.cooldownTotal[type] = def.cooldown
    const p: Plant = {
      id: this.nextId++, type, r, c, x: cellX(c), y: rowY(r), hp: def.hp, max: def.hp,
      timer: def.role === 'producer' ? 6 : def.role === 'mine' ? def.rate : 0.4,
      t: 0, flash: 0, recoil: 0, armed: false, fuse: def.role === 'bomb' ? 1 : 0, hurtT: 0, volleyLeft: 0, volleyT: 0,
    }
    this.grid[r]![c] = p
    this.plants.push(p)
    this.emit({ type: 'plant', x: p.x, y: p.y, plant: type })
    return true
  }

  dig(r: number, c: number): boolean {
    const p = this.grid[r]?.[c]
    if (!p || this.state !== 'playing') return false
    this.removePlant(p)
    this.emit({ type: 'dig', x: p.x, y: p.y })
    return true
  }

  /** Picks up the dew drop nearest to a point, if one is close enough. */
  collectAt(x: number, y: number, radius = 52): boolean {
    let best: Dew | null = null
    let bestD = radius * radius
    for (const d of this.dews) {
      if (d.collected) continue
      const dx = d.x - x
      const dy = d.y - y
      const dist = dx * dx + dy * dy
      if (dist < bestD) {
        best = d
        bestD = dist
      }
    }
    if (!best) return false
    this.collect(best)
    return true
  }

  private collect(d: Dew) {
    d.collected = true
    d.ct = 0
    this.dew += d.value
    this.emit({ type: 'collect', x: d.x, y: d.y, value: d.value })
  }

  private removePlant(p: Plant) {
    if (this.grid[p.r]![p.c] === p) this.grid[p.r]![p.c] = null
    const i = this.plants.indexOf(p)
    if (i >= 0) this.plants.splice(i, 1)
    p.hp = 0
  }

  private losePlant(p: Plant) {
    if (!this.plants.includes(p)) return
    this.removePlant(p)
    this.stats.plantsLost++
    this.emit({ type: 'plantLost', x: p.x, y: p.y, plant: p.type })
  }

  private spawnRobot(def: SpawnDef) {
    const base = ROBOTS[def.type]
    const isBoss = def.type === 'boss'
    const hp = isBoss ? this.level.bossHp : base.hp
    const rb: Robot = {
      id: this.nextId++, type: def.type, r: def.row, x: LAWN_RIGHT + 70 + this.rng.range(0, 40), lift: base.flying ? 28 : 0,
      hp, max: hp, armor: base.armor, maxArmor: base.armor, slow: 0, flash: 0, t: this.rng.range(0, 3), dying: 0, eating: false,
      sprite: base.sprite, canJump: !!base.jumps, jumpT: 0, jumpFrom: 0, jumpTo: 0, pause: 0, chompT: 0,
      laneLift: 0, summonT: 6, laneT: 4, laserT: 9, laserTarget: null, laserWarn: 0,
    }
    if (isBoss) {
      rb.x = LAWN_RIGHT + 120
      this.boss = rb
    }
    this.robots[def.row]!.push(rb)
    this.emit({ type: 'robotIn', robot: def.type })
  }

  /** Damages a robot. Straight shots hit a shield first; helmets take everything first. */
  private damage(rb: Robot, amount: number, kind: ShotKind | 'blast' | 'spike') {
    if (rb.dying) return
    rb.flash = 0.08
    const def = ROBOTS[rb.type]
    let rest = amount
    const straight = kind === 'ember' || kind === 'frost' || kind === 'leaf'
    const armored = rb.armor > 0 && (def.armorKind === 'helmet' || (def.armorKind === 'shield' && straight))
    if (armored) {
      rb.armor -= rest
      rest = kind === 'blast' && rb.armor < 0 ? -rb.armor : 0
      if (rb.armor <= 0) {
        rb.armor = 0
        rb.sprite = def.bare ?? def.sprite
        this.emit({ type: 'armorOff', x: rb.x, y: rowY(rb.r) - 70, kind: def.armorKind! })
      }
    }
    // Frost slows only what it actually reaches: not through a shield.
    if (kind === 'frost' && !(def.armorKind === 'shield' && armored)) rb.slow = 4
    this.emit({ type: 'hit', x: rb.x - def.radius * 0.6, y: rowY(rb.r) - 64 - rb.lift, kind, armor: armored })
    if (rest > 0) rb.hp -= rest
    if (rb.hp <= 0) this.kill(rb)
  }

  private kill(rb: Robot) {
    if (rb.dying) return
    rb.dying = rb.type === 'boss' ? 1.4 : 0.55
    rb.hp = 0
    this.stats.robotsBeaten++
    this.emit({ type: 'kill', x: rb.x, y: rowY(rb.r) - 60 - rb.lift, robot: rb.type })
    if (rb.type === 'boss') {
      this.emit({ type: 'explode', x: rb.x, y: rowY(rb.r) - 100, radius: 260, kind: 'boss' })
      // The boss's fall takes its army with it.
      for (const row of this.robots) for (const other of row) if (other !== rb && !other.dying) this.kill(other)
      this.spawnIndex = this.level.spawns.length
    }
  }

  private dropDew(x: number, y: number, value: number, fromSky: boolean) {
    if (fromSky) {
      const r = this.rng.pick(this.level.rows)
      this.dews.push({ x, y: -20, vx: 0, vy: this.level.rain ? 110 : 70, g: 0, ty: BOARD.y + r * BOARD.cellH + this.rng.range(40, 80), landed: false, life: 10, collected: false, ct: 0, value, t: this.rng.range(0, 6) })
    }
    else {
      this.dews.push({ x, y, vx: this.rng.range(-50, 50), vy: -240, g: 650, ty: y + 34, landed: false, life: 10, collected: false, ct: 0, value, t: this.rng.range(0, 6) })
    }
    this.emit({ type: 'dewDrop', x, y })
  }

  private hasTarget(r: number, x: number) {
    for (const rb of this.robots[r]!) if (!rb.dying && rb.x > x - 20 && rb.x < HIT_LIMIT_X) return true
    return false
  }

  private fire(p: Plant) {
    const def = PLANTS[p.type]
    const s = this.shots.find(q => !q.on)
    if (!s) return
    s.on = true
    s.kind = def.projectile!
    s.r = p.r
    s.damage = def.damage
    s.hits.length = 0
    if (def.role === 'lobber') {
      // Aim where the nearest robot will be when the seed lands.
      let target: Robot | null = null
      for (const rb of this.robots[p.r]!) if (!rb.dying && rb.x > p.x && rb.x < HIT_LIMIT_X && (!target || rb.x < target.x)) target = rb
      if (!target) {
        s.on = false
        return
      }
      s.dur = 0.9
      s.t = 0
      s.x0 = s.x = p.x + 6
      s.y0 = s.y = p.y - 66
      const moving = target.eating || target.pause > 0 ? 0 : ROBOTS[target.type].speed * this.level.speed * (target.slow > 0 ? 0.5 : 1)
      s.x1 = Math.max(p.x + 30, target.x - moving * s.dur)
    }
    else {
      s.x = p.x + 40
      s.y = p.y - 58 - (p.type === 'twin' && p.volleyLeft % 2 === 1 ? -10 : 0)
    }
    p.recoil = 0.12
    this.emit({ type: 'shoot', x: s.x, y: s.y, kind: s.kind })
  }

  private explode(x: number, rows: number[], radius: number, damage: number) {
    for (const r of rows) {
      if (r < 0 || r >= BOARD.rows) continue
      for (const rb of this.robots[r]!) if (!rb.dying && Math.abs(rb.x - x) < radius) this.damage(rb, damage, 'blast')
    }
  }

  step(dt = STEP) {
    if (this.state !== 'playing') {
      this.updateDews(dt)
      return
    }
    this.time += dt
    const L = this.level

    // Waves are announced when they start (a huge one a few seconds early, as a warning).
    while (this.wave < L.waves.length) {
      const w = L.waves[this.wave]!
      if (this.time < w.at - (w.huge ? 4 : 0)) break
      this.wave++
      if (this.wave > 1 && L.waveBonus) this.dew += L.waveBonus
      this.emit({ type: 'wave', wave: this.wave, huge: w.huge, final: this.wave === L.waves.length })
    }
    while (this.spawnIndex < L.spawns.length && L.spawns[this.spawnIndex]!.t <= this.time) this.spawnRobot(L.spawns[this.spawnIndex++]!)

    if (L.skyDew) {
      this.skyT -= dt
      if (this.skyT <= 0) {
        this.dropDew(BOARD.x + 50 + this.rng.next() * (BOARD.cellW * BOARD.cols - 100), 0, DEW_VALUE, true)
        this.skyT = this.rng.range(8, 11.5) * (L.rain ? 0.7 : 1)
      }
    }
    for (const id of this.loadout) if ((this.cooldown[id] ?? 0) > 0) this.cooldown[id] = Math.max(0, this.cooldown[id]! - dt)

    this.updatePlants(dt)
    this.updateShots(dt)
    for (let r = 0; r < BOARD.rows; r++) {
      this.updateRobots(r, dt)
      if (this.state !== 'playing') return
      this.updateCart(r, dt)
    }
    this.updateDews(dt)

    if (this.spawnIndex >= L.spawns.length && this.robots.every(row => row.length === 0)) {
      this.state = 'won'
      this.stars = 1 + (this.stats.cartsUsed === 0 ? 1 : 0) + (this.stats.plantsLost === 0 ? 1 : 0)
      // Dew still lying around is picked up for you.
      for (const d of this.dews) if (!d.collected) this.collect(d)
      this.emit({ type: 'won', stars: this.stars })
    }
  }

  private updatePlants(dt: number) {
    for (let i = this.plants.length - 1; i >= 0; i--) {
      const p = this.plants[i]!
      const def = PLANTS[p.type]
      p.t += dt
      if (p.flash > 0) p.flash -= dt
      if (p.recoil > 0) p.recoil -= dt
      switch (def.role) {
        case 'producer':
          p.timer -= dt
          if (p.timer <= 0) {
            this.dropDew(p.x, p.y - 64, def.dew!, false)
            p.timer = def.rate
          }
          break
        case 'shooter':
          if (p.volleyLeft > 0) {
            p.volleyT -= dt
            if (p.volleyT <= 0) {
              this.fire(p)
              p.volleyLeft--
              p.volleyT = 0.16
            }
          }
          p.timer -= dt
          if (p.timer <= 0 && this.hasTarget(p.r, p.x)) {
            this.fire(p)
            p.volleyLeft = (def.volley ?? 1) - 1
            p.volleyT = 0.16
            p.timer = def.rate
          }
          break
        case 'lobber':
          p.timer -= dt
          if (p.timer <= 0 && this.hasTarget(p.r, p.x)) {
            this.fire(p)
            p.timer = def.rate
          }
          break
        case 'bomb':
          p.fuse -= dt
          if (p.fuse <= 0) {
            this.removePlant(p)
            this.explode(p.x, [p.r - 1, p.r, p.r + 1], 170, def.damage)
            this.emit({ type: 'explode', x: p.x, y: p.y - 40, radius: 170, kind: 'corn' })
          }
          break
        case 'mine':
          if (!p.armed) {
            p.timer -= dt
            if (p.timer <= 0) {
              p.armed = true
              this.emit({ type: 'armed', x: p.x, y: p.y })
            }
          }
          else {
            for (const rb of this.robots[p.r]!) {
              if (!rb.dying && !ROBOTS[rb.type].flying && rb.jumpT <= 0 && Math.abs(rb.x - p.x) < 50) {
                this.removePlant(p)
                this.explode(p.x, [p.r], 75, def.damage)
                this.emit({ type: 'explode', x: p.x, y: p.y - 20, radius: 75, kind: 'coconut' })
                break
              }
            }
          }
          break
        case 'spikes':
          p.timer -= dt
          if (p.timer <= 0) {
            p.timer = def.rate
            for (const rb of this.robots[p.r]!) {
              if (!rb.dying && !ROBOTS[rb.type].flying && rb.jumpT <= 0 && Math.abs(rb.x - p.x) < 56) this.damage(rb, def.damage, 'spike')
            }
          }
          break
        case 'wall':
          break
      }
    }
  }

  private updateShots(dt: number) {
    for (const s of this.shots) {
      if (!s.on) continue
      if (s.kind === 'seed') {
        s.t += dt
        const u = Math.min(1, s.t / s.dur)
        s.x = s.x0 + (s.x1 - s.x0) * u
        s.y = s.y0 + (rowY(s.r) - 50 - s.y0) * u - Math.sin(u * Math.PI) * 120
        if (u >= 1) {
          s.on = false
          let hit: Robot | null = null
          for (const rb of this.robots[s.r]!) {
            if (rb.dying || rb.x > HIT_LIMIT_X) continue
            if (Math.abs(rb.x - s.x) < 60 && (!hit || Math.abs(rb.x - s.x) < Math.abs(hit.x - s.x))) hit = rb
          }
          if (hit) {
            this.damage(hit, s.damage, 'seed')
            for (const rb of this.robots[s.r]!) if (rb !== hit && !rb.dying && Math.abs(rb.x - s.x) < 80) this.damage(rb, 15, 'seed')
          }
        }
        continue
      }
      s.x += SHOT_SPEED * dt
      if (s.x > BOARD.width + 20) {
        s.on = false
        continue
      }
      for (const rb of this.robots[s.r]!) {
        if (rb.dying || rb.x > HIT_LIMIT_X || rb.jumpT > 0.15) continue
        if (Math.abs(rb.x - s.x) >= ROBOTS[rb.type].radius) continue
        if (s.kind === 'leaf') {
          if (s.hits.includes(rb.id)) continue
          s.hits.push(rb.id)
          this.damage(rb, s.damage, s.kind)
          continue
        }
        this.damage(rb, s.damage, s.kind)
        s.on = false
        break
      }
    }
  }

  private updateRobots(r: number, dt: number) {
    const row = this.robots[r]!
    const L = this.level
    for (let i = row.length - 1; i >= 0; i--) {
      const rb = row[i]!
      const def = ROBOTS[rb.type]
      rb.t += dt
      if (rb.flash > 0) rb.flash -= dt
      if (rb.dying) {
        rb.dying -= dt
        if (rb.dying <= 0) {
          row.splice(i, 1)
          if (rb === this.boss) this.boss = null
        }
        continue
      }
      if (rb.slow > 0) rb.slow -= dt
      const mul = (rb.slow > 0 ? 0.5 : 1) * L.speed

      if (rb.type === 'boss') {
        this.updateBoss(rb, dt, mul)
        continue
      }

      if (rb.jumpT > 0) {
        rb.jumpT -= dt
        const u = 1 - Math.max(0, rb.jumpT) / 0.7
        rb.x = rb.jumpFrom + (rb.jumpTo - rb.jumpFrom) * u
        rb.lift = Math.sin(u * Math.PI) * 80
        if (rb.jumpT <= 0) {
          rb.lift = 0
          rb.jumpT = 0
        }
        continue
      }
      if (rb.pause > 0) {
        rb.pause -= dt
        continue
      }

      if (!def.flying) {
        const front = rb.x - def.radius * 0.9
        const col = Math.floor((front - BOARD.x) / BOARD.cellW)
        const target = col >= 0 && col < BOARD.cols ? this.grid[r]![col] : null
        const p = target && PLANTS[target.type].role !== 'spikes' && !(PLANTS[target.type].role === 'mine' && target.armed) ? target : null

        // A tank flattens spikes it rolls over, and the spikes bite back.
        if (def.crushes && target && PLANTS[target.type].role === 'spikes' && Math.abs(target.x - rb.x) < 40) {
          this.losePlant(target)
          this.damage(rb, 300, 'spike')
          this.emit({ type: 'crush', x: target.x, y: target.y })
        }

        if (p) {
          if (rb.canJump) {
            rb.canJump = false
            rb.sprite = def.bare ?? def.sprite
            if (PLANTS[p.type].tall) {
              this.emit({ type: 'armorOff', x: rb.x, y: rowY(r) - 70, kind: 'pogo' })
              rb.pause = 0.5
            }
            else {
              rb.jumpT = 0.7
              rb.jumpFrom = rb.x
              rb.jumpTo = p.x - 64
              this.emit({ type: 'jump', x: rb.x, y: rowY(r) })
            }
            continue
          }
          if (def.crushes) {
            this.losePlant(p)
            this.emit({ type: 'crush', x: p.x, y: p.y })
            rb.pause = 0.6
            continue
          }
          rb.eating = true
          p.hp -= def.dps * mul * dt
          p.hurtT -= dt
          if (p.hurtT <= 0) {
            p.flash = 0.07
            p.hurtT = 0.35
          }
          rb.chompT -= dt
          if (rb.chompT <= 0) {
            rb.chompT = 0.3
            this.emit({ type: 'chomp', x: rb.x - def.radius - 8, y: rowY(r) - 60 })
          }
          if (p.hp <= 0) this.losePlant(p)
          continue
        }
      }
      rb.eating = false
      rb.x -= def.speed * mul * dt

      if (rb.x < BOARD.x + 24 && this.carts[r]!.state === 'idle') {
        this.carts[r]!.state = 'go'
        this.stats.cartsUsed++
        this.emit({ type: 'cart', row: r })
      }
      if (rb.x < 26 && this.carts[r]!.state === 'gone') {
        this.state = 'lost'
        this.emit({ type: 'lost' })
        return
      }
    }
  }

  private updateBoss(rb: Robot, dt: number, mul: number) {
    if (rb.x > BOSS_STOP_X) rb.x = Math.max(BOSS_STOP_X, rb.x - ROBOTS.boss.speed * mul * dt)
    if (rb.laneLift !== 0) rb.laneLift *= Math.max(0, 1 - dt * 3.5)
    if (Math.abs(rb.laneLift) < 1) rb.laneLift = 0
    rb.lift = -rb.laneLift
    if (rb.x > LAWN_RIGHT) return

    rb.summonT -= dt
    if (rb.summonT <= 0) {
      rb.summonT = 10
      for (let k = 0; k < 1 + Math.floor(this.level.world / 3); k++) {
        const row = this.rng.pick(this.level.rows)
        this.robots[row]!.push({
          ...rb, id: this.nextId++, type: 'mini', r: row, x: rb.x + 30, lift: 0, hp: ROBOTS.mini.hp, max: ROBOTS.mini.hp, armor: 0, maxArmor: 0,
          sprite: 'mini', canJump: false, pause: 0.4, laserTarget: null, laserWarn: 0, laneLift: 0, slow: 0, dying: 0, eating: false,
        })
      }
      this.emit({ type: 'summon', x: rb.x, y: rowY(rb.r) - 120 })
    }

    rb.laneT -= dt
    if (rb.laneT <= 0 && rb.laserWarn <= 0) {
      rb.laneT = 7
      const choices = this.level.rows.filter(r => r !== rb.r)
      if (choices.length) {
        const to = this.rng.pick(choices)
        const row = this.robots[rb.r]!
        row.splice(row.indexOf(rb), 1)
        rb.laneLift = rowY(to) - rowY(rb.r)
        rb.r = to
        this.robots[to]!.push(rb)
      }
    }

    if (rb.laserWarn > 0) {
      rb.laserWarn -= dt
      if (rb.laserWarn <= 0) {
        const t = rb.laserTarget
        rb.laserTarget = null
        if (t && this.plants.includes(t)) {
          this.losePlant(t)
          this.emit({ type: 'laser', x: t.x, y: t.y - 40 })
        }
      }
      return
    }
    rb.laserT -= dt
    if (rb.laserT <= 0) {
      rb.laserT = 12
      let target: Plant | null = null
      for (const p of this.grid[rb.r]!) if (p && (!target || p.x > target.x)) target = p
      if (target) {
        rb.laserTarget = target
        rb.laserWarn = 1.3
        this.emit({ type: 'laserWarn', x: target.x, y: target.y - 40 })
      }
    }
  }

  private updateCart(r: number, dt: number) {
    const cart = this.carts[r]!
    if (cart.state !== 'go') return
    cart.x += 540 * dt
    // It clears its row as far as the lawn goes; robots still out on the road are safe.
    for (const rb of this.robots[r]!) {
      if (rb.dying || rb.x > LAWN_RIGHT + 30 || Math.abs(rb.x - cart.x) > 46) continue
      if (rb.type === 'boss') {
        this.damage(rb, 1000, 'blast')
        cart.state = 'gone'
        return
      }
      this.kill(rb)
    }
    if (cart.x > BOARD.width + 80) cart.state = 'gone'
  }

  private updateDews(dt: number) {
    for (let i = this.dews.length - 1; i >= 0; i--) {
      const d = this.dews[i]!
      d.t += dt
      if (d.collected) {
        d.ct += dt
        if (d.ct >= 0.5) this.dews.splice(i, 1)
        continue
      }
      if (!d.landed) {
        d.vy += d.g * dt
        d.x += d.vx * dt
        d.y += d.vy * dt
        if (d.vy > 0 && d.y >= d.ty) {
          d.y = d.ty
          d.landed = true
        }
      }
      else {
        d.life -= dt
        if (this.autoCollect && d.life < 9.4) this.collect(d)
        else if (d.life <= 0) this.dews.splice(i, 1)
      }
    }
  }
}
