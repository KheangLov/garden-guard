import { describe, expect, it } from 'vitest'
import {
  Engine, PLANT_ORDER, PLANT_UNLOCKS, PLANTS, ROBOT_UNLOCKS, SPRITES, STORY, TOTAL_LEVELS, WORLDS,
  getLevel, levelLabel, spriteSvg, suggestedLoadout, type SpriteName,
} from '../../shared/game'
import { autoplay } from './helpers/autoplay'

describe('levels', () => {
  it('has 120 levels in six worlds of twenty, each with robots to beat', () => {
    expect(TOTAL_LEVELS).toBe(120)
    expect(WORLDS).toHaveLength(6)
    for (let n = 1; n <= TOTAL_LEVELS; n++) {
      const level = getLevel(n)
      expect(level.spawns.length, `level ${n}`).toBeGreaterThan(0)
      expect(level.waves.length).toBeGreaterThan(0)
      for (const s of level.spawns) expect(level.rows, `level ${n} row`).toContain(s.row)
      for (const [r, c] of level.blocked) {
        expect(c).toBeGreaterThan(0)
        expect(level.rows).toContain(r)
      }
      expect(level.plants.length).toBeGreaterThanOrEqual(2)
      expect(suggestedLoadout(level).length).toBeLessThanOrEqual(level.slots)
    }
  })

  it('is the same every time (seeded)', () => {
    expect(JSON.stringify(getLevel(57))).toBe(JSON.stringify(getLevel(57)))
  })

  it('labels levels by world', () => {
    expect(levelLabel(1)).toBe('1-1')
    expect(levelLabel(20)).toBe('1-20')
    expect(levelLabel(21)).toBe('2-1')
    expect(levelLabel(120)).toBe('6-20')
  })

  it('ends every world with a boss and introduces every plant and robot', () => {
    for (let world = 0; world < 6; world++) {
      const level = getLevel(world * 20 + 20)
      expect(level.kind).toBe('boss')
      expect(level.spawns.some(s => s.type === 'boss')).toBe(true)
    }
    for (const id of PLANT_ORDER) expect(getLevel(PLANT_UNLOCKS[id]).plants).toContain(id)
    for (const [id, n] of Object.entries(ROBOT_UNLOCKS)) {
      if (n > 1) expect(getLevel(n).newRobot).toBe(id)
    }
  })

  it('gets harder: more robots later', () => {
    const total = (n: number) => getLevel(n).spawns.length
    expect(total(60)).toBeGreaterThan(total(5))
    expect(total(118)).toBeGreaterThan(total(40))
  })

  it('does not bring producers to a last stand', () => {
    const level = getLevel(25)
    expect(level.kind).toBe('laststand')
    expect(suggestedLoadout(level).some(id => PLANTS[id].role === 'producer')).toBe(false)
  })
})

describe('engine', () => {
  it('plants only where and when it may', () => {
    const engine = new Engine(getLevel(1), ['bulb', 'chili'])
    expect(engine.canPlant('bulb', 0, 0)).toBe('row')
    expect(engine.plant('bulb', 2, 0)).toBe(true)
    expect(engine.dew).toBe(100)
    expect(engine.canPlant('chili', 2, 0)).toBe('occupied')
    expect(engine.canPlant('bulb', 2, 1)).toBe('cooldown')
    expect(engine.plant('chili', 2, 1)).toBe(true)
    expect(engine.canPlant('chili', 2, 2)).toBe('cooldown')
    expect(engine.dig(2, 1)).toBe(true)
    expect(engine.grid[2]![1]).toBeNull()
  })

  it('collects dew dropped by a producer', () => {
    const engine = new Engine(getLevel(1), ['bulb', 'chili'])
    engine.plant('bulb', 2, 0)
    for (let i = 0; i < 60 * 7; i++) engine.step()
    const drop = engine.dews.find(d => !d.collected)
    expect(drop).toBeTruthy()
    const before = engine.dew
    expect(engine.collectAt(drop!.x, drop!.y)).toBe(true)
    expect(engine.dew).toBeGreaterThan(before)
  })

  it('loses when robots get past an empty row twice (the garden cart saves you once)', () => {
    const engine = new Engine(getLevel(6), ['bulb', 'chili'])
    for (let i = 0; i < 60 * 400 && engine.state === 'playing'; i++) engine.step()
    expect(engine.stats.cartsUsed).toBeGreaterThanOrEqual(1)
    expect(engine.state).toBe('lost')
  })

  it('a simple player wins every level of the first world and every boss', () => {
    for (let n = 1; n <= 20; n++) expect(autoplay(n).state, `level ${levelLabel(n)}`).toBe('won')
    for (const n of [40, 60, 80, 100, 120]) expect(autoplay(n).state, `boss ${levelLabel(n)}`).toBe('won')
  })

  it('is fair but not a walkover: a simple player wins most levels, not all with three stars', () => {
    const results = Array.from({ length: TOTAL_LEVELS }, (_, i) => autoplay(i + 1))
    const won = results.filter(e => e.state === 'won')
    expect(won.length).toBeGreaterThanOrEqual(110)
    expect(won.filter(e => e.stars === 3).length).toBeLessThan(won.length)
  }, 60_000)
})

describe('sprites and story', () => {
  it('turns every sprite into SVG', () => {
    for (const name of Object.keys(SPRITES) as SpriteName[]) {
      const svg = spriteSvg(name)
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg).not.toContain('undefined')
    }
  })

  it('has a scene for every world', () => {
    for (const w of WORLDS) {
      expect(STORY[w.id].intro.length).toBeGreaterThan(0)
      expect(STORY[w.id].outro.length).toBeGreaterThan(0)
    }
  })
})
