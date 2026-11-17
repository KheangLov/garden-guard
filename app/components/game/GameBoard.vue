<script setup lang="ts">
/**
 * The board: the 3D garden filling the space it's given, the game loop, and touch/mouse input on
 * the lawn. The loop steps the engine at a fixed 60 steps a second (twice as many at double speed),
 * however fast the screen refreshes, and draws once per screen frame. Taps and drags are turned into
 * board points by the view (app/game/three/lawn.ts).
 */
import { STEP, type Engine, type GameEvent, type PlantId } from '#shared/game'
import { ICON_MODELS, LawnView, type BoardUi } from '~/game/three/lawn'
import { ensureIcons } from '~/game/three/icons'

const props = defineProps<{
  engine: Engine
  selection: PlantId | 'shovel' | null
  paused: boolean
  speed: number
  /** A tile was tapped (or a dragged seed dropped on it). */
  onTile: (r: number, c: number, seed?: PlantId) => void
  /** Things that happened in the game since the last frame. */
  onEvents: (events: GameEvent[]) => void
  /** Every frame, after the game moved on (to update the top bar without Vue). */
  onFrame?: () => void
}>()

const { t } = useI18n()
const progress = useProgressStore()
const wrap = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const overlay = ref<HTMLElement | null>(null)
const reduced = useReducedMotion()
const failed = ref(false)
let view: LawnView | null = null
let raf = 0
let last = 0
let acc = 0
const ui: BoardUi = { hover: null, seed: null, shovel: false, drag: null }

watch(() => props.selection, (s) => {
  ui.seed = s && s !== 'shovel' ? s : null
  ui.shovel = s === 'shovel'
}, { immediate: true })
watch(() => props.paused, () => {
  last = performance.now()
})
watch(reduced, (r) => {
  if (view) view.reducedMotion = r
})

function fit() {
  const el = wrap.value
  if (!el || !view) return
  const box = el.getBoundingClientRect()
  view.resize(Math.max(1, Math.floor(box.width)), Math.max(1, Math.floor(box.height)), window.devicePixelRatio || 1)
}

function frame(now: number) {
  raf = requestAnimationFrame(frame)
  let dt = (now - last) / 1000
  last = now
  if (dt > 0.25) dt = 0.25
  const engine = props.engine
  if (!view) return
  if (!props.paused) {
    acc += dt * props.speed
    let steps = 0
    while (acc >= STEP && steps < 12) {
      engine.step(STEP)
      acc -= STEP
      steps++
    }
    if (steps === 12) acc = 0
    const events = engine.drainEvents()
    if (events.length) {
      view.handle(events)
      props.onEvents(events)
    }
    view.update(dt * Math.min(props.speed, 2))
  }
  props.onFrame?.()
  view.render(engine, ui)
}

function local(e: { clientX: number, clientY: number }) {
  const rect = canvas.value!.getBoundingClientRect()
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    inside: e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom,
  }
}

function onPointerDown(e: PointerEvent) {
  if (!view || props.paused || props.engine.state !== 'playing') return
  const p = local(e)
  // Dew first: a drop on top of a tile is what you meant to tap.
  const dew = view.dewAt(props.engine, p.x, p.y, e.pointerType !== 'mouse')
  if (dew && props.engine.collectAt(dew.x, dew.y, 8)) {
    props.onEvents(props.engine.drainEvents())
    return
  }
  const at = view.groundAt(p.x, p.y)
  const tile = at && LawnView.tileAt(at.x, at.y)
  if (tile && props.selection) props.onTile(tile.r, tile.c)
}

function onPointerMove(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || dragSeed || !view) return
  const p = local(e)
  const at = view.groundAt(p.x, p.y)
  ui.hover = at ? LawnView.tileAt(at.x, at.y) : null
}

function onPointerLeave(e: PointerEvent) {
  if (e.pointerType === 'mouse' && !dragSeed) ui.hover = null
}

/* Dragging a seed from its card onto the lawn. */
let dragSeed: PlantId | null = null
let dragStart = { x: 0, y: 0 }
let dragMoved = false

function startDrag(seed: PlantId, e: PointerEvent) {
  dragSeed = seed
  dragStart = { x: e.clientX, y: e.clientY }
  dragMoved = false
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
  window.addEventListener('pointercancel', onDragCancel)
}

function onDragMove(e: PointerEvent) {
  if (!dragSeed || !view) return
  if (!dragMoved && Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > 10) dragMoved = true
  if (!dragMoved) return
  const p = local(e)
  const at = p.inside ? view.groundAt(p.x, p.y) : null
  ui.drag = at
  ui.hover = at ? LawnView.tileAt(at.x, at.y) : null
  ui.seed = dragSeed
}

function onDragEnd(e: PointerEvent) {
  const seed = dragSeed
  const moved = dragMoved
  onDragCancel()
  if (!seed || !moved || !view) return
  const p = local(e)
  const at = p.inside ? view.groundAt(p.x, p.y) : null
  const tile = at ? LawnView.tileAt(at.x, at.y) : null
  if (tile) props.onTile(tile.r, tile.c, seed)
}

function onDragCancel() {
  dragSeed = null
  ui.drag = null
  ui.seed = props.selection && props.selection !== 'shovel' ? props.selection : null
  if (!ui.seed) ui.hover = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointercancel', onDragCancel)
}

/** Whether the last pointer-down on a card turned into a drag (so the tap shouldn't also select). */
function wasDrag() {
  return dragMoved
}

let observer: ResizeObserver | null = null
onMounted(() => {
  try {
    view = new LawnView(canvas.value!, overlay.value!, props.engine.level, progress.settings.hd ? 'high' : 'low')
  }
  catch {
    failed.value = true
    return
  }
  view.reducedMotion = reduced.value
  void ensureIcons(ICON_MODELS)
  observer = new ResizeObserver(fit)
  observer.observe(wrap.value!)
  fit()
  last = performance.now()
  raf = requestAnimationFrame(frame)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  observer?.disconnect()
  onDragCancel()
  view?.dispose()
  view = null
})

defineExpose({ startDrag, wasDrag, redraw: () => {} })
</script>

<template>
  <div
    ref="wrap"
    class="relative size-full overflow-hidden rounded-xl shadow-[0_10px_40px_rgb(0_0_0/0.45)]"
  >
    <canvas
      ref="canvas"
      class="block size-full touch-none"
      role="img"
      :aria-label="t('game.board')"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
    />
    <div
      ref="overlay"
      class="lawn-overlay pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    />
    <p
      v-if="failed"
      class="absolute inset-0 flex items-center justify-center p-6 text-center text-moss-100"
    >
      {{ t('game.noWebgl') }}
    </p>
  </div>
</template>
