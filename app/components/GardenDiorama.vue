<script setup lang="ts">
/**
 * The menus' background: the garden in 3D, turning slowly, with guardians planted and a few
 * Bolt-Bots waiting on the street. It uses the game's own engine and view (a made-up level with no
 * waves), and stops whenever a level is being played, so only one 3D scene ever runs at a time.
 * Without WebGL, the plain backdrop shows.
 */
import { Engine, PLANT_ORDER, STEP, getLevel, type LevelDef, type PlantId } from '#shared/game'
import { LawnView } from '~/game/three/lawn'

const props = defineProps<{ world: number }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const overlay = ref<HTMLElement | null>(null)
const progress = useProgressStore()
const reduced = useReducedMotion()
const ready = ref(false)
let view: LawnView | null = null
let engine: Engine | null = null
let raf = 0
let last = 0
let acc = 0
let yaw = -0.4

function scene(world: number): LevelDef {
  const base = getLevel(world * 20 + 5)
  // One robot far in the future, so the level never ends.
  return { ...base, rows: [0, 1, 2, 3, 4], blocked: [], spawns: [{ t: 1e9, type: 'bot', row: 2, wave: 1 }], waves: [{ at: 1e9, huge: false }], fogCols: 0, skyDew: false, plants: [...PLANT_ORDER], noProducers: false }
}

const PLAN: [PlantId, number, number][] = [
  ['bulb', 0, 0], ['chili', 0, 1], ['pumpkin', 0, 3],
  ['bulb', 1, 0], ['twin', 1, 1], ['mint', 1, 2],
  ['bulb', 2, 0], ['bamboo', 2, 1], ['corn', 2, 4],
  ['moonbulb', 3, 0], ['chili', 3, 1], ['sugarpalm', 3, 3],
  ['bulb', 4, 0], ['lotus', 4, 1], ['durian', 4, 5],
]

function start() {
  stop()
  try {
    engine = new Engine(scene(props.world), [...PLANT_ORDER])
    for (const [type, r, c] of PLAN) {
      engine.dew = 9999
      for (const id of PLANT_ORDER) engine.cooldown[id] = 0
      engine.plant(type, r, c)
    }
    engine.drainEvents()
    view = new LawnView(canvas.value!, overlay.value!, engine.level, progress.settings.hd ? 'high' : 'low', { scenic: true })
    const bots = ['bot', 'brute', 'shield', 'drone', 'pogo', 'mini'] as const
    bots.forEach((name, i) => view!.addProp(name, 5.4 + (i % 2) * 0.7, -2 + i * 0.8, 0.9, 1.1))
  }
  catch {
    view = null
    return
  }
  ready.value = true
  fit()
  last = performance.now()
  raf = requestAnimationFrame(frame)
}

function stop() {
  cancelAnimationFrame(raf)
  view?.dispose()
  view = null
  ready.value = false
}

function fit() {
  view?.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1)
}

function frame(now: number) {
  raf = requestAnimationFrame(frame)
  if (!view || !engine || document.hidden) return
  let dt = (now - last) / 1000
  last = now
  if (dt > 0.1) dt = 0.1
  acc += dt
  while (acc >= STEP) {
    engine.step(STEP)
    acc -= STEP
  }
  view.handle(engine.drainEvents())
  if (!reduced.value) {
    yaw += dt * 0.035
    view.orbit(Math.sin(yaw) * 0.55)
  }
  view.update(dt)
  view.render(engine, { hover: null, seed: null, shovel: false, drag: null })
}

watch(() => props.world, () => {
  if (view) start()
})
onMounted(() => {
  start()
  window.addEventListener('resize', fit)
})
onBeforeUnmount(() => {
  stop()
  window.removeEventListener('resize', fit)
})
</script>

<template>
  <div
    class="pointer-events-none fixed inset-0 -z-10 transition-opacity duration-700"
    :class="ready ? 'opacity-100' : 'opacity-0'"
    aria-hidden="true"
  >
    <canvas
      ref="canvas"
      class="block size-full"
    />
    <div
      ref="overlay"
      class="hidden"
    />
    <!-- Darkened towards the middle, where the menus are, so text stays easy to read. -->
    <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(7_20_13/0.72),rgb(7_20_13/0.35)_70%,rgb(7_20_13/0.2))]" />
  </div>
</template>
