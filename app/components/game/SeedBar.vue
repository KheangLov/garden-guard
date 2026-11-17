<script setup lang="ts">
/**
 * The seed cards and the shovel. Tap a card to pick it (tap again to put it back), or drag it onto
 * the lawn. The recharge sweep and "not enough dew" state are written straight to the cards every
 * frame by sync(), without going through Vue, so the bar costs nothing while you play.
 */
import { PLANTS, type Engine, type PlantId } from '#shared/game'

const props = defineProps<{ engine: Engine, selection: PlantId | 'shovel' | null }>()
const emit = defineEmits<{
  select: [id: PlantId]
  shovel: []
  drag: [id: PlantId, event: PointerEvent]
}>()
const { locale, t } = useI18n()
const cards = ref<HTMLElement[]>([])
const last = new Map<HTMLElement, { cd: string, poor: string, ready: string }>()

function sync() {
  const engine = props.engine
  engine.loadout.forEach((id, i) => {
    const el = cards.value[i]
    if (!el) return
    const def = PLANTS[id]
    const left = engine.cooldown[id] ?? 0
    const cd = left > 0 ? (left / (engine.cooldownTotal[id] || def.cooldown)).toFixed(3) : '0'
    const banned = engine.level.noProducers && def.role === 'producer'
    const poor = String(engine.dew < def.cost || banned)
    const ready = String(engine.seedReady(id))
    const prev = last.get(el)
    if (prev?.cd !== cd) el.style.setProperty('--cd', cd)
    if (prev?.poor !== poor) el.dataset.poor = poor
    if (prev?.ready !== ready) el.dataset.ready = ready
    last.set(el, { cd, poor, ready })
  })
}

defineExpose({ sync })
</script>

<template>
  <div
    class="flex items-end gap-1.5 sm:gap-2"
    role="toolbar"
    :aria-label="t('level.seeds')"
  >
    <button
      v-for="(id, i) in props.engine.loadout"
      :key="id"
      :ref="(el) => { if (el) cards[i] = el as HTMLElement }"
      type="button"
      class="seed-card"
      :data-selected="props.selection === id"
      :aria-pressed="props.selection === id"
      :aria-label="t('game.seedCost', { name: t(`plants.${id}.name`), cost: localNumber(PLANTS[id].cost, locale) })"
      :title="`${t(`plants.${id}.name`)} · ${t(`plants.${id}.desc`)}`"
      @pointerdown="(e: PointerEvent) => emit('drag', id, e)"
      @click="emit('select', id)"
    >
      <SpriteIcon :name="PLANTS[id].sprite" />
      <span class="cost">{{ localNumber(PLANTS[id].cost, locale) }}</span>
      <kbd class="absolute start-1 top-0.5 hidden font-sans text-[10px] font-bold text-[#7a5a2a] [@media(pointer:fine)]:block">{{ i + 1 }}</kbd>
    </button>
    <button
      type="button"
      class="btn-icon ms-1 size-12! rounded-full!"
      :aria-pressed="props.selection === 'shovel'"
      :aria-label="t('game.shovel')"
      :title="t('game.shovel')"
      @click="emit('shovel')"
    >
      <UIcon
        name="i-lucide-shovel"
        class="size-6"
      />
    </button>
  </div>
</template>
