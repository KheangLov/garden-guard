/**
 * A reasonable player for tests and balancing: builds dew early, puts the strongest shooters it has
 * in the busiest rows, walls up the front, and uses corn or coconut mines on big threats.
 */
import { BOARD, Engine, PLANTS, STEP, getLevel, suggestedLoadout, type PlantId } from '../../../shared/game'

export function autoplay(n: number, maxSeconds = 900) {
  const level = getLevel(n)
  const engine = new Engine(level, suggestedLoadout(level))
  engine.autoCollect = true
  const has = (id: PlantId) => engine.loadout.includes(id)
  const producer: PlantId | null = level.noProducers ? null : level.night && has('moonbulb') ? 'moonbulb' : has('bulb') ? 'bulb' : has('moonbulb') ? 'moonbulb' : null
  const tryPlant = (id: PlantId, r: number, cols: number[]) => {
    if (!has(id)) return false
    for (const c of cols) if (engine.canPlant(id, r, c) === 'ok') return engine.plant(id, r, c)
    return false
  }
  const colOf = (x: number) => Math.max(0, Math.min(BOARD.cols - 1, Math.floor((x - BOARD.x) / BOARD.cellW)))
  const threat = (r: number) => engine.robots[r]!.reduce((sum, rb) => sum + (rb.dying ? 0 : (rb.hp + rb.armor) * (rb.type === 'boss' ? 0.15 : 1)), 0)
  const shooterCount = (r: number) => engine.grid[r]!.filter(p => p && ['shooter', 'lobber'].includes(PLANTS[p.type].role)).length
  const producers = () => engine.plants.filter(p => PLANTS[p.type].role === 'producer').length
  const targetProducers = Math.min(level.rows.length * 2, level.night ? 10 : 8)

  let t = 0
  while (engine.state === 'playing' && t < maxSeconds) {
    for (let k = 0; k < 30 && engine.state === 'playing'; k++) engine.step(STEP)
    t += 0.5
    const rows = [...level.rows].sort((a, b) => threat(b) - threat(a))
    // A boss on the lawn: corn on it whenever there's corn.
    const boss = engine.boss
    if (boss && !boss.dying && boss.x < BOARD.x + BOARD.cellW * BOARD.cols) tryPlant('corn', boss.r, [colOf(boss.x), colOf(boss.x) - 1])
    for (const r of rows) {
      const live = engine.robots[r]!.filter(rb => !rb.dying)
      const front = live.length ? Math.min(...live.map(rb => rb.x)) : Infinity
      // Big trouble close to the house: corn, or a mine in front of it.
      if (live.length && front < BOARD.x + BOARD.cellW * 5 && (threat(r) > 900 || live.length >= 4 || live.some(rb => rb.type === 'tank'))) {
        if (tryPlant('corn', r, [colOf(front)])) continue
        if (tryPlant('coconut', r, [colOf(front) - 1, colOf(front) - 2].filter(c => c >= 0))) continue
      }
      const want = 1 + Math.ceil(threat(r) / 700)
      if (shooterCount(r) < want || (shooterCount(r) < 3 && engine.dew > 400)) {
        const shields = live.some(rb => rb.type === 'shield' && rb.armor > 0)
        const order: PlantId[] = shields ? ['lotus', 'twin', 'bamboo', 'mint', 'chili'] : ['twin', 'bamboo', 'mint', 'chili', 'lotus']
        let done = false
        for (const s of order) if (!done && engine.dew >= PLANTS[s].cost && tryPlant(s, r, [2, 3, 4, 1, 5])) done = true
        if (done) continue
      }
      if (producer && producers() < targetProducers && (threat(r) < 300 || shooterCount(r) > 0)) {
        if (tryPlant(producer, r, [0, 1])) continue
      }
      if (live.length) {
        const wall: PlantId = level.spawns.some(s => s.type === 'pogo') && has('sugarpalm') ? 'sugarpalm' : 'pumpkin'
        if (tryPlant(wall, r, [6, 5])) continue
        if (engine.dew > 350) tryPlant('durian', r, [7])
      }
    }
  }
  return engine
}

export function autoplayStats(n: number) {
  const e = autoplay(n)
  return { n, state: e.state, stars: e.stars, time: Math.round(e.time), kind: e.level.kind, carts: e.stats.cartsUsed, lost: e.stats.plantsLost, robots: e.level.spawns.length }
}
