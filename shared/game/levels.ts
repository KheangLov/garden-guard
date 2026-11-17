/**
 * The 120 levels: six worlds of twenty. Each level is generated from its number with a seeded random
 * generator, so it is the same on every device and every time, and tests can check them all.
 *
 * Inside a world: levels 1–3 of the first world teach the basics on fewer rows; every world has two
 * "last stand" levels (lots of dew, no producers, build first), a "rush hour" at its 10th level
 * (faster robots) and a boss at its 20th. New plants and robots arrive on fixed levels (data.ts).
 */
import { LEVELS_PER_WORLD, PLANT_ORDER, PLANT_UNLOCKS, PLANTS, ROBOT_UNLOCKS, ROBOTS, type PlantId, type RobotId } from './data'
import { createRng } from './rng'

export const TOTAL_LEVELS = 120

export type WorldId = 'backyard' | 'moonlit' | 'terraces' | 'temple' | 'river' | 'factory'

export interface WorldDef {
  id: WorldId
  night: boolean
  /** Dew falls from the sky (by day; and from the factory's dripping pipes). */
  skyDew: boolean
  rain: boolean
  /** Grass, the patio and the road. */
  palette: { grassA: string, grassB: string, patio: string, patioLine: string, road: string, edge: string, sky: string }
  /** Small things drawn on the lawn. */
  decor: 'flowers' | 'fireflies' | 'rice' | 'stones' | 'reeds' | 'bolts'
  /** Colours of the world's card on the map. */
  accent: { from: string, to: string }
}

export const WORLDS: WorldDef[] = [
  { id: 'backyard', night: false, skyDew: true, rain: false, decor: 'flowers', accent: { from: '#8fd36a', to: '#2f8f4a' },
    palette: { grassA: '#7cc45a', grassB: '#6bb54b', patio: '#b9875a', patioLine: '#8a5d36', road: '#6d6f73', edge: '#9a9ca0', sky: '#8fd3ff' } },
  { id: 'moonlit', night: true, skyDew: false, rain: false, decor: 'fireflies', accent: { from: '#7b6cf0', to: '#24215a' },
    palette: { grassA: '#2f5b3a', grassB: '#284f32', patio: '#5d4a3c', patioLine: '#3f3127', road: '#3a3c46', edge: '#55586a', sky: '#14143a' } },
  { id: 'terraces', night: false, skyDew: true, rain: false, decor: 'rice', accent: { from: '#d8e86a', to: '#5f9a2a' },
    palette: { grassA: '#a6c95a', grassB: '#93b94a', patio: '#a98a5a', patioLine: '#7a6038', road: '#7d6a4f', edge: '#a28c6a', sky: '#bfe6ff' } },
  { id: 'temple', night: false, skyDew: true, rain: false, decor: 'stones', accent: { from: '#e8c48a', to: '#8a5a2a' },
    palette: { grassA: '#86b45c', grassB: '#78a64f', patio: '#b9ad94', patioLine: '#8a7f68', road: '#8c8270', edge: '#ada38e', sky: '#ffd9a8' } },
  { id: 'river', night: false, skyDew: true, rain: true, decor: 'reeds', accent: { from: '#5fc9e8', to: '#1e5a7a' },
    palette: { grassA: '#5f9a6a', grassB: '#548d5e', patio: '#7d6a58', patioLine: '#5a4a3c', road: '#3f6f86', edge: '#6f9fb4', sky: '#5d7286' } },
  { id: 'factory', night: true, skyDew: true, rain: false, decor: 'bolts', accent: { from: '#ff6b6b', to: '#3a1f4a' },
    palette: { grassA: '#4f5a3a', grassB: '#465031', patio: '#4a4a52', patioLine: '#2f2f36', road: '#2b2b33', edge: '#4a4a55', sky: '#1d1428' } },
]

export type LevelKind = 'tutorial' | 'normal' | 'laststand' | 'rush' | 'boss'

export interface SpawnDef {
  /** Seconds after the level starts. */
  t: number
  type: RobotId
  row: number
  /** Which wave it belongs to (1-based). */
  wave: number
}

export interface WaveDef {
  at: number
  huge: boolean
}

export interface LevelDef {
  /** 1 to TOTAL_LEVELS. */
  n: number
  world: number
  /** 0 to 19 inside its world. */
  index: number
  kind: LevelKind
  /** Rows with grass (tutorials use fewer). */
  rows: number[]
  startDew: number
  skyDew: boolean
  night: boolean
  rain: boolean
  /** Fog over this many columns at the right of the lawn. */
  fogCols: number
  /** Robot speed multiplier. */
  speed: number
  /** Tiles you can't plant on: [row, col]. */
  blocked: [number, number][]
  waves: WaveDef[]
  spawns: SpawnDef[]
  /** Plants you have by this level. */
  plants: PlantId[]
  newPlant?: PlantId
  newRobot?: RobotId
  /** How many seeds you can take into the level. */
  slots: number
  noProducers: boolean
  bossHp: number
  /** Dew given at the start of each wave after the first (last stands). */
  waveBonus: number
}

export function worldOf(n: number) {
  return Math.floor((n - 1) / LEVELS_PER_WORLD)
}

/** "3-7": world and level inside it. */
export function levelLabel(n: number) {
  return `${worldOf(n) + 1}-${((n - 1) % LEVELS_PER_WORLD) + 1}`
}

export function plantsAt(n: number): PlantId[] {
  return PLANT_ORDER.filter(id => PLANT_UNLOCKS[id] <= n)
}

export function slotsAt(n: number) {
  return n < 40 ? 6 : n < 80 ? 7 : 8
}

const cache = new Map<number, LevelDef>()

export function getLevel(n: number): LevelDef {
  if (!Number.isInteger(n) || n < 1 || n > TOTAL_LEVELS) throw new RangeError(`No level ${n}`)
  let level = cache.get(n)
  if (!level) {
    level = buildLevel(n)
    cache.set(n, level)
  }
  return level
}

function buildLevel(n: number): LevelDef {
  const rng = createRng(n * 7919 + 17)
  const world = worldOf(n)
  const index = (n - 1) % LEVELS_PER_WORLD
  const w = WORLDS[world]!

  const kind: LevelKind = n <= 3
    ? 'tutorial'
    : index === LEVELS_PER_WORLD - 1
      ? 'boss'
      : index === 9
        ? 'rush'
        : world > 0 && (index === 4 || index === 14)
          ? 'laststand'
          : 'normal'

  const rows = n === 1 ? [2] : n === 2 ? [1, 2, 3] : [0, 1, 2, 3, 4]
  const plants = plantsAt(n)
  const newPlant = PLANT_ORDER.find(id => PLANT_UNLOCKS[id] === n && n > 1)
  const newRobot = (Object.keys(ROBOT_UNLOCKS) as (keyof typeof ROBOT_UNLOCKS)[]).find(id => ROBOT_UNLOCKS[id] === n && n > 1)
  const laststand = kind === 'laststand'

  // Fog drifts over the terraces' later levels and some of the factory's.
  const fogCols = (w.id === 'terraces' && index >= 5) || (w.id === 'factory' && index % 3 === 1) ? 3 : 0

  // Rubble in the temple and the factory: a few tiles you can't use, never in the first column.
  const blocked: [number, number][] = []
  if ((w.id === 'temple' || w.id === 'factory') && kind !== 'boss') {
    const count = 2 + Math.floor(index / 5)
    let tries = 0
    while (blocked.length < count && tries++ < 50) {
      const r = rng.pick(rows)
      const c = rng.int(2, 7)
      if (blocked.some(([br, bc]) => br === r && bc === c) || blocked.filter(([br]) => br === r).length >= 2) continue
      blocked.push([r, c])
    }
  }

  const night = w.night
  const skyDew = w.skyDew && !laststand
  const startDew = laststand ? 1200 + world * 450 : n === 1 ? 150 : n <= 3 ? 100 : !w.skyDew ? 150 : 50
  const speed = (kind === 'rush' ? 1.25 : 1) * (w.rain ? 1.05 : 1)

  // Robots this level can send: those introduced by now, newer ones rarer at first.
  const pool = (Object.keys(ROBOT_UNLOCKS) as (keyof typeof ROBOT_UNLOCKS)[]).filter(id => ROBOT_UNLOCKS[id] <= n)
  const weightOf = (id: keyof typeof ROBOT_UNLOCKS) => {
    if (id === 'bot') return 3
    const age = n - ROBOT_UNLOCKS[id]
    return Math.min(2.2, 0.6 + age / 12)
  }

  const waveCount = n === 1 ? 2 : n <= 3 ? 3 : kind === 'boss' ? 4 : Math.min(4 + Math.floor(n / 16), 10)
  let budget = n === 1 ? 6 : n === 2 ? 9 : 4 + Math.min(n, 60) * 0.95 + Math.max(0, n - 60) * 0.5 + index * 0.15
  if (laststand) budget *= 1.2
  if (kind === 'boss') budget *= 0.5

  const firstAt = laststand ? 32 : night ? 26 : n === 1 ? 14 : 20
  const waves: WaveDef[] = []
  const spawns: SpawnDef[] = []
  const weights = Array.from({ length: waveCount }, (_, i) => (i === waveCount - 1 ? (i + 1) * 2.4 : i + 1))
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  let at = firstAt
  let lastRow = -1
  const pickRow = () => {
    let r = rng.pick(rows)
    if (r === lastRow && rows.length > 1 && rng.next() < 0.6) r = rng.pick(rows)
    lastRow = r
    return r
  }

  for (let wi = 0; wi < waveCount; wi++) {
    const huge = wi === waveCount - 1 && waveCount > 1
    waves.push({ at, huge })
    let waveBudget = (budget * weights[wi]!) / totalWeight
    // The level's new robot shows up early and a couple of times, so you meet it properly.
    const queue: RobotId[] = []
    if (newRobot && (wi === 0 || wi === Math.floor(waveCount / 2))) {
      queue.push(newRobot)
      waveBudget -= ROBOTS[newRobot].cost
    }
    while (waveBudget > 0.25) {
      const affordable = pool.filter(id => ROBOTS[id].cost <= waveBudget + 0.5)
      const choices = affordable.length ? affordable : ['bot' as const]
      const total = choices.reduce((sum, id) => sum + weightOf(id), 0)
      let roll = rng.next() * total
      let chosen: keyof typeof ROBOT_UNLOCKS = choices[0]!
      for (const id of choices) {
        roll -= weightOf(id)
        if (roll <= 0) {
          chosen = id
          break
        }
      }
      queue.push(chosen)
      waveBudget -= ROBOTS[chosen].cost
    }
    // Spread the wave out; a huge wave arrives in a rush.
    const gap = huge ? 1.1 : Math.max(1.6, 3.4 - n * 0.015)
    let t = at
    for (const type of queue) {
      if (type === 'mini') {
        const row = pickRow()
        for (let k = 0; k < 3; k++) spawns.push({ t: t + k * 0.45, type, row, wave: wi + 1 })
      }
      else {
        spawns.push({ t, type, row: pickRow(), wave: wi + 1 })
      }
      t += gap * rng.range(0.75, 1.25)
    }
    if (kind === 'boss' && huge) spawns.push({ t: at + 1.5, type: 'boss', row: 2, wave: wi + 1 })
    at = t + (huge ? 0 : Math.max(14, 26 - wi))
  }
  spawns.sort((a, b) => a.t - b.t)

  return {
    n, world, index, kind, rows, startDew, skyDew, night, rain: w.rain, fogCols, speed, blocked,
    waves, spawns, plants, newPlant, newRobot,
    slots: slotsAt(n),
    noProducers: laststand,
    bossHp: kind === 'boss' ? 1800 + world * 900 : 0,
    waveBonus: laststand ? 150 + world * 50 : 0,
  }
}

/** Seeds to bring by default: producers first (unless banned), then attackers, walls and bombs. */
export function suggestedLoadout(level: LevelDef, previous: PlantId[] = []): PlantId[] {
  const allowed = level.plants.filter(id => !(level.noProducers && PLANTS[id].role === 'producer'))
  const picked = previous.filter(id => allowed.includes(id))
  const order: PlantId[] = [
    ...(level.night ? ['moonbulb', 'bulb'] as PlantId[] : ['bulb', 'moonbulb'] as PlantId[]),
    'chili', 'pumpkin', 'corn', 'mint', 'twin', 'lotus', 'sugarpalm', 'bamboo', 'durian', 'coconut',
  ]
  for (const id of order) {
    if (picked.length >= level.slots) break
    if (allowed.includes(id) && !picked.includes(id)) picked.push(id)
  }
  if (level.newPlant && allowed.includes(level.newPlant) && !picked.includes(level.newPlant)) {
    picked[picked.length >= level.slots ? picked.length - 1 : picked.length] = level.newPlant
  }
  return picked.slice(0, level.slots)
}
