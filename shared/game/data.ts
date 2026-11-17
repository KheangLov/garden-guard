/**
 * The board, the plants and the robots: every number that balances the game is here.
 * Units: board units (the board is BOARD.width × BOARD.height), seconds, dew.
 */
import type { SpriteName } from './sprites'

export const BOARD = {
  width: 1240,
  height: 560,
  /** The lawn's top-left corner, its tiles and size. */
  x: 110,
  y: 24,
  cellW: 112,
  cellH: 104,
  cols: 9,
  rows: 5,
} as const
export const LAWN_RIGHT = BOARD.x + BOARD.cellW * BOARD.cols
/** Robots are hit only once they're on the lawn (not while still on the street). */
export const HIT_LIMIT_X = LAWN_RIGHT + 30

export const cellX = (c: number) => BOARD.x + c * BOARD.cellW + BOARD.cellW / 2
/** The line a row's characters stand on. */
export const rowY = (r: number) => BOARD.y + r * BOARD.cellH + 96

export type PlantId
  = | 'bulb' | 'moonbulb' | 'chili' | 'twin' | 'mint' | 'bamboo' | 'lotus'
    | 'pumpkin' | 'sugarpalm' | 'corn' | 'coconut' | 'durian'

export type PlantRole = 'producer' | 'shooter' | 'lobber' | 'wall' | 'bomb' | 'mine' | 'spikes'

export interface PlantDef {
  id: PlantId
  role: PlantRole
  cost: number
  /** Seed recharge after planting. */
  cooldown: number
  /** Seed recharge when a level starts. */
  startCooldown: number
  hp: number
  /** Producers: seconds between drops; attackers: seconds between shots. */
  rate: number
  damage: number
  /** Dew per drop (producers). */
  dew?: number
  /** Blocks jumping robots. */
  tall?: boolean
  projectile?: 'ember' | 'frost' | 'leaf' | 'seed'
  /** Shots per volley (twin). */
  volley?: number
  sprite: SpriteName
}

export const PLANTS: Record<PlantId, PlantDef> = {
  bulb: { id: 'bulb', role: 'producer', cost: 50, cooldown: 7.5, startCooldown: 0, hp: 300, rate: 12, damage: 0, dew: 25, sprite: 'bulb' },
  moonbulb: { id: 'moonbulb', role: 'producer', cost: 25, cooldown: 7.5, startCooldown: 0, hp: 300, rate: 9, damage: 0, dew: 15, sprite: 'moonbulb' },
  chili: { id: 'chili', role: 'shooter', cost: 100, cooldown: 7.5, startCooldown: 0, hp: 300, rate: 1.45, damage: 20, projectile: 'ember', sprite: 'chili' },
  twin: { id: 'twin', role: 'shooter', cost: 200, cooldown: 7.5, startCooldown: 0, hp: 300, rate: 1.45, damage: 20, projectile: 'ember', volley: 2, sprite: 'twin' },
  mint: { id: 'mint', role: 'shooter', cost: 175, cooldown: 7.5, startCooldown: 0, hp: 300, rate: 1.45, damage: 20, projectile: 'frost', sprite: 'mint' },
  bamboo: { id: 'bamboo', role: 'shooter', cost: 225, cooldown: 7.5, startCooldown: 0, hp: 300, rate: 2.2, damage: 30, projectile: 'leaf', sprite: 'bamboo' },
  lotus: { id: 'lotus', role: 'lobber', cost: 125, cooldown: 7.5, startCooldown: 0, hp: 300, rate: 2.6, damage: 40, projectile: 'seed', sprite: 'lotus' },
  pumpkin: { id: 'pumpkin', role: 'wall', cost: 50, cooldown: 20, startCooldown: 0, hp: 4000, rate: 0, damage: 0, sprite: 'pumpkin' },
  sugarpalm: { id: 'sugarpalm', role: 'wall', cost: 125, cooldown: 20, startCooldown: 10, hp: 8000, rate: 0, damage: 0, tall: true, sprite: 'sugarpalm' },
  corn: { id: 'corn', role: 'bomb', cost: 150, cooldown: 35, startCooldown: 20, hp: 9999, rate: 1, damage: 1800, sprite: 'corn' },
  coconut: { id: 'coconut', role: 'mine', cost: 25, cooldown: 25, startCooldown: 15, hp: 300, rate: 12, damage: 1800, sprite: 'coconut' },
  durian: { id: 'durian', role: 'spikes', cost: 100, cooldown: 7.5, startCooldown: 0, hp: 300, rate: 1, damage: 20, sprite: 'durian' },
}

/** The order seeds appear in lists. */
export const PLANT_ORDER: PlantId[] = ['bulb', 'moonbulb', 'chili', 'twin', 'mint', 'bamboo', 'lotus', 'pumpkin', 'sugarpalm', 'corn', 'coconut', 'durian']

/** The level that introduces each plant (it's yours from then on). */
export const PLANT_UNLOCKS: Record<PlantId, number> = {
  bulb: 1, chili: 1, pumpkin: 3, corn: 5, mint: 8, durian: 12, twin: 15,
  moonbulb: 21, sugarpalm: 24, lotus: 27, coconut: 32, bamboo: 36,
}

export type RobotId = 'bot' | 'brute' | 'mini' | 'drone' | 'pogo' | 'shield' | 'tank' | 'boss'

export interface RobotDef {
  id: RobotId
  hp: number
  /** Extra protection, used up first: a helmet (any hit) or a shield (only hits from the front). */
  armor: number
  armorKind?: 'helmet' | 'shield'
  speed: number
  /** Damage per second to a plant it's stopped at. */
  dps: number
  flying?: boolean
  /** Jumps over the first plant in its way (not a tall one). */
  jumps?: boolean
  /** Flattens plants instead of chewing them. */
  crushes?: boolean
  /** What it costs a level's wave budget. */
  cost: number
  sprite: SpriteName
  /** The sprite once its armor or pogo stick is gone. */
  bare?: SpriteName
  /** Half its width, for hits. */
  radius: number
}

export const ROBOTS: Record<RobotId, RobotDef> = {
  bot: { id: 'bot', hp: 200, armor: 0, speed: 20, dps: 50, cost: 1, sprite: 'bot', radius: 28 },
  brute: { id: 'brute', hp: 200, armor: 550, armorKind: 'helmet', speed: 17, dps: 60, cost: 2.5, sprite: 'brute', bare: 'bot', radius: 30 },
  mini: { id: 'mini', hp: 70, armor: 0, speed: 34, dps: 30, cost: 0.5, sprite: 'mini', radius: 20 },
  drone: { id: 'drone', hp: 140, armor: 0, speed: 26, dps: 0, flying: true, cost: 2, sprite: 'drone', radius: 28 },
  pogo: { id: 'pogo', hp: 300, armor: 0, speed: 30, dps: 50, jumps: true, cost: 2.5, sprite: 'pogo', bare: 'bot', radius: 28 },
  shield: { id: 'shield', hp: 200, armor: 900, armorKind: 'shield', speed: 18, dps: 50, cost: 4, sprite: 'shield', bare: 'bot', radius: 30 },
  tank: { id: 'tank', hp: 1600, armor: 0, speed: 12, dps: 0, crushes: true, cost: 8, sprite: 'tank', radius: 50 },
  boss: { id: 'boss', hp: 4000, armor: 0, speed: 14, dps: 0, cost: 0, sprite: 'boss', radius: 70 },
}

/** The level that introduces each robot. */
export const ROBOT_UNLOCKS: Record<Exclude<RobotId, 'boss'>, number> = {
  bot: 1, brute: 4, mini: 9, drone: 13, pogo: 22, shield: 28, tank: 36,
}

export const DEW_VALUE = 25
export const SHOT_SPEED = 430
export const LEVELS_PER_WORLD = 20
