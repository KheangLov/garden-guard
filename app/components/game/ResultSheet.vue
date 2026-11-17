<script setup lang="ts">
/** The end of a level: stars and what earned them, or a tip after a loss. */
import { motion } from 'motion-v'
import { LEVELS_PER_WORLD, TOTAL_LEVELS, getLevel, type Engine } from '#shared/game'

const props = defineProps<{ engine: Engine }>()
const emit = defineEmits<{ next: [], replay: [], levels: [] }>()
const { locale, t } = useI18n()
const reduced = useReducedMotion()
const nextButton = ref<HTMLButtonElement | null>(null)

const won = computed(() => props.engine.state === 'won')
const level = computed(() => props.engine.level)
const hasNext = computed(() => level.value.n < TOTAL_LEVELS)
const nextPlant = computed(() => hasNext.value ? getLevel(level.value.n + 1).newPlant : undefined)
const worldDone = computed(() => won.value && level.value.kind === 'boss')

const criteria = computed(() => [
  { key: 'star1', ok: won.value },
  { key: 'star2', ok: props.engine.stats.cartsUsed === 0 },
  { key: 'star3', ok: props.engine.stats.plantsLost === 0 },
])

const tip = computed(() => {
  const types = new Set(level.value.spawns.map(s => s.type))
  if (types.has('shield') && level.value.plants.includes('lotus')) return 'shields'
  if (types.has('pogo') && level.value.plants.includes('sugarpalm')) return 'pogo'
  if (types.has('tank')) return 'tank'
  if (!level.value.skyDew && level.value.plants.includes('moonbulb')) return 'night'
  return (['economy', 'walls', 'corn'] as const)[level.value.n % 3]!
})

onMounted(() => setTimeout(() => nextButton.value?.focus(), 400))
</script>

<template>
  <motion.div
    :initial="reduced ? false : { opacity: 0 }"
    :animate="{ opacity: 1 }"
    class="fixed inset-0 z-40 flex items-center justify-center bg-moss-950/70 p-4 backdrop-blur-sm"
    role="alertdialog"
    aria-modal="true"
    :aria-label="won ? t('result.won') : t('result.lost')"
  >
    <motion.div
      :initial="reduced ? false : { scale: 0.7, y: 40, opacity: 0 }"
      :animate="{ scale: 1, y: 0, opacity: 1 }"
      :transition="{ type: 'spring', stiffness: 260, damping: 18 }"
      class="glass flex w-full max-w-md flex-col items-center gap-3 p-6 text-center landscape:max-lg:max-w-2xl landscape:max-lg:flex-row landscape:max-lg:flex-wrap landscape:max-lg:justify-center landscape:max-lg:gap-x-6 landscape:max-lg:p-4"
    >
      <div class="flex flex-col items-center gap-2">
        <p
          v-if="worldDone"
          class="chip text-sun-200"
        >
          <UIcon
            name="i-lucide-trophy"
            class="size-4"
          />
          {{ level.n === TOTAL_LEVELS ? t('result.theEnd') : t('result.worldDone', { n: localNumber(Math.ceil(level.n / LEVELS_PER_WORLD), locale) }) }}
        </p>
        <h2
          class="font-display text-4xl leading-tight"
          :class="won ? 'text-glow' : 'text-berry'"
        >
          {{ won ? t('result.won') : t('result.lost') }}
        </h2>
        <StarRow
          v-if="won"
          :count="props.engine.stars"
          size="size-12"
          animate
          :label="t('map.stars', { n: localNumber(props.engine.stars, locale) })"
        />
        <SpriteIcon
          v-else
          name="bot"
          class="size-20"
        />
      </div>

      <div class="flex flex-col items-center gap-3">
        <ul
          v-if="won"
          class="flex flex-col gap-1 text-start text-sm"
        >
          <li
            v-for="c in criteria"
            :key="c.key"
            class="flex items-center gap-2"
            :class="c.ok ? 'text-leaf-200' : 'text-moss-400'"
          >
            <UIcon
              :name="c.ok ? 'i-lucide-circle-check' : 'i-lucide-circle'"
              class="size-4"
            />
            {{ t(`result.${c.key}`) }}
          </li>
        </ul>
        <template v-else>
          <p class="text-moss-200">
            {{ t('result.lostText') }}
          </p>
          <p class="flex items-start gap-2 rounded-xl bg-sun-500/15 p-3 text-start text-sm text-sun-100">
            <UIcon
              name="i-lucide-lightbulb"
              class="mt-0.5 size-4 shrink-0 text-sun-300"
            />
            {{ t(`result.tips.${tip}`) }}
          </p>
        </template>

        <p
          v-if="won && nextPlant"
          class="flex items-center gap-2 text-sm text-leaf-200"
        >
          <SpriteIcon
            :name="nextPlant"
            class="size-8"
          />
          {{ t('result.unlocked', { name: t(`plants.${nextPlant}.name`) }) }}
        </p>

        <div class="flex flex-wrap justify-center gap-2">
          <button
            v-if="won && hasNext"
            ref="nextButton"
            type="button"
            class="btn-game"
            @click="emit('next')"
          >
            {{ t('result.next') }}
            <UIcon
              name="i-lucide-chevron-right"
              class="size-5"
            />
          </button>
          <button
            :ref="(el) => { if (!won || !hasNext) nextButton = el as HTMLButtonElement }"
            type="button"
            class="btn-game"
            :class="won && hasNext ? 'ghost' : 'sun'"
            @click="emit('replay')"
          >
            <UIcon
              name="i-lucide-rotate-ccw"
              class="size-5"
            />
            {{ won ? t('result.replay') : t('result.retry') }}
          </button>
          <button
            type="button"
            class="btn-game ghost"
            @click="emit('levels')"
          >
            <UIcon
              name="i-lucide-map"
              class="size-5"
            />
            {{ t('result.levels') }}
          </button>
        </div>
      </div>
    </motion.div>
  </motion.div>
</template>
