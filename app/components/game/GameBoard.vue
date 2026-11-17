<script setup lang="ts">
/**
 * The board: a canvas that fills the space it's given at the board's shape, the game loop, and
 * touch/mouse input on the lawn. The loop steps the engine at a fixed 60 steps a second (twice as
 * many at double speed), however fast the screen refreshes, and draws once per screen frame.
 */
import { BOARD, STEP, type Engine, type GameEvent, type PlantId } from '#shared/game'
import { Renderer, type BoardUi } from '~/game/renderer'

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
const wrap = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const reduced = useReducedMotion()
let renderer: Renderer | null = null
let raf = 0
let last = 0
let acc = 0
let dirty = true
const ui: BoardUi = { hover: null, seed: null, shovel: false, drag: null }
const size = reactive({ w: 0, h: 0 })

watch(() => props.selection, (s) => {
  ui.seed = s && s !== 'shovel' ? s : null
  ui.shovel = s === 'shovel'
  dirty = true
}, { immediate: true })
watch(() => props.paused, () => {
  last = performance.now()
  dirty = true
})
watch(reduced, (r) => {
  if (renderer) renderer.reducedMotion = r
})

function fit() {
  const el = wrap.value
  if (!el || !canvas.value || !renderer) return
  const box = el.getBoundingClientRect()
  const w = Math.max(1, Math.min(box.width, (box.height * BOARD.width) / BOARD.height))
  const h = (w * BOARD.height) / BOARD.width
  size.w = Math.floor(w)
  size.h = Math.floor(h)
  renderer.resize(size.w, size.h, window.devicePixelRatio || 1)
  dirty = true
}

function frame(now: number) {
  raf = requestAnimationFrame(frame)
  let dt = (now - last) / 1000
  last = now
  if (dt > 0.25) dt = 0.25
  const engine = props.engine
  if (!props.paused && renderer) {
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
      renderer.handle(events)
      props.onEvents(events)
    }
    renderer.update(dt * Math.min(props.speed, 2))
    dirty = true
  }
  props.onFrame?.()
  if (dirty && renderer) {
    renderer.render(engine, ui)
    dirty = !props.paused
  }
}

function toBoard(e: { clientX: number, clientY: number }) {
  const rect = canvas.value!.getBoundingClientRect()
  return {
    x: ((e.clientX - rect.left) / rect.width) * BOARD.width,
    y: ((e.clientY - rect.top) / rect.height) * BOARD.height,
    inside: e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom,
  }
}

function onPointerDown(e: PointerEvent) {
  if (props.paused || props.engine.state !== 'playing') return
  const p = toBoard(e)
  // Dew first: a drop on top of a tile is what you meant to tap.
  if (props.engine.collectAt(p.x, p.y, e.pointerType === 'mouse' ? 46 : 60)) {
    props.onEvents(props.engine.drainEvents())
    dirty = true
    return
  }
  const tile = Renderer.tileAt(p.x, p.y)
  if (tile && props.selection) props.onTile(tile.r, tile.c)
  dirty = true
}

function onPointerMove(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || dragSeed) return
  const p = toBoard(e)
  ui.hover = Renderer.tileAt(p.x, p.y)
  dirty = true
}

function onPointerLeave(e: PointerEvent) {
  if (e.pointerType === 'mouse' && !dragSeed) {
    ui.hover = null
    dirty = true
  }
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
  if (!dragSeed) return
  if (!dragMoved && Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > 10) dragMoved = true
  if (!dragMoved) return
  const p = toBoard(e)
  ui.drag = p.inside ? { x: p.x, y: p.y } : null
  ui.hover = p.inside ? Renderer.tileAt(p.x, p.y) : null
  ui.seed = dragSeed
  dirty = true
}

function onDragEnd(e: PointerEvent) {
  const seed = dragSeed
  const moved = dragMoved
  onDragCancel()
  if (!seed || !moved) return
  const p = toBoard(e)
  const tile = p.inside ? Renderer.tileAt(p.x, p.y) : null
  if (tile) props.onTile(tile.r, tile.c, seed)
}

function onDragCancel() {
  dragSeed = null
  ui.drag = null
  ui.seed = props.selection && props.selection !== 'shovel' ? props.selection : null
  if (!ui.seed) ui.hover = null
  dirty = true
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
  renderer = new Renderer(canvas.value!, props.engine.level)
  renderer.reducedMotion = reduced.value
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
})

defineExpose({ startDrag, wasDrag, redraw: () => (dirty = true) })
</script>

<template>
  <div
    ref="wrap"
    class="relative flex size-full items-center justify-center"
  >
    <canvas
      ref="canvas"
      class="block touch-none rounded-xl shadow-[0_10px_40px_rgb(0_0_0/0.45)]"
      :style="{ width: `${size.w}px`, height: `${size.h}px` }"
      role="img"
      :aria-label="t('game.board')"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
    />
  </div>
</template>
