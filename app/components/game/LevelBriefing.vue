<script setup lang="ts">
/**
 * Before a level: what's special about it, who's coming (with the new plant or robot in the
 * spotlight), and which seeds to bring when there are more than fit in the bar.
 */
import { motion } from 'motion-v'
import { PLANTS, ROBOTS, WORLDS, levelLabel, suggestedLoadout, type LevelDef, type PlantId, type RobotId } from '#shared/game'

const props = defineProps<{ level: LevelDef }>()
const loadout = defineModel<PlantId[]>('loadout', { required: true })
const emit = defineEmits<{ start: [], back: [] }>()
const { locale, t } = useI18n()
const progress = useProgressStore()
const reduced = useReducedMotion()
const audio = useUiSound()

const world = computed(() => WORLDS[props.level.world]!)
const label = computed(() => localDigits(levelLabel(props.level.n), locale.value))
const choosing = computed(() => props.level.plants.length > props.level.slots || props.level.noProducers)
const robots = computed(() => [...new Set(props.level.spawns.map(s => s.type))] as RobotId[])
const best = computed(() => progress.stars[props.level.n] ?? 0)

const mods = computed(() => {
  const L = props.level
  const list: { key: string, icon: string }[] = []
  if (L.kind === 'boss') list.push({ key: 'boss', icon: 'i-lucide-crown' })
  if (L.kind === 'laststand') list.push({ key: 'laststand', icon: 'i-lucide-shield' })
  if (L.kind === 'rush') list.push({ key: 'rush', icon: 'i-lucide-zap' })
  if (L.rows.length < 5) list.push({ key: 'rows', icon: 'i-lucide-rows-3' })
  if (L.night && !L.skyDew && L.kind !== 'laststand') list.push({ key: 'night', icon: 'i-lucide-moon' })
  if (L.fogCols) list.push({ key: 'fog', icon: 'i-lucide-cloud-fog' })
  if (L.blocked.length) list.push({ key: 'rubble', icon: 'i-lucide-mountain' })
  if (L.rain) list.push({ key: 'rain', icon: 'i-lucide-cloud-lightning' })
  return list
})

function allowed(id: PlantId) {
  return !(props.level.noProducers && PLANTS[id].role === 'producer')
}

function toggle(id: PlantId) {
  if (!allowed(id)) {
    audio.ui('nope')
    return
  }
  const i = loadout.value.indexOf(id)
  if (i >= 0) loadout.value = loadout.value.filter(x => x !== id)
  else if (loadout.value.length < props.level.slots) loadout.value = [...loadout.value, id]
  else {
    audio.ui('nope')
    return
  }
  audio.ui('select')
}

function suggest() {
  audio.ui('select')
  loadout.value = suggestedLoadout(props.level)
}

const pop = (delay: number) => reduced.value
  ? {}
  : { initial: { opacity: 0, y: 16, scale: 0.96 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: { type: 'spring' as const, stiffness: 240, damping: 20, delay } }
</script>

<template>
  <div class="mx-auto flex w-full max-w-4xl flex-col gap-3 p-[calc(0.75rem+var(--safe-top))_calc(1rem+var(--safe-right))_calc(1rem+var(--safe-bottom))_calc(1rem+var(--safe-left))]">
    <motion.header
      v-bind="pop(0)"
      class="flex items-center gap-3"
    >
      <button
        type="button"
        class="btn-icon"
        :aria-label="t('map.back')"
        @click="emit('back')"
      >
        <UIcon
          name="i-lucide-arrow-left"
          class="size-5"
        />
      </button>
      <div class="me-auto">
        <p class="text-sm text-muted">
          {{ t(`worlds.${world.id}.name`) }}
        </p>
        <h1 class="font-display text-3xl leading-tight text-glow">
          {{ t(`kinds.${props.level.kind}`) }} {{ label }}
        </h1>
      </div>
      <div
        v-if="best"
        class="flex flex-col items-end"
      >
        <span class="text-xs text-muted">{{ t('level.best') }}</span>
        <StarRow
          :count="best"
          size="size-5"
          :label="t('map.stars', { n: localNumber(best, locale) })"
        />
      </div>
    </motion.header>

    <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] landscape:max-lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <motion.section
        v-bind="pop(0.06)"
        class="glass flex flex-col gap-3 p-4"
      >
        <ul
          v-if="mods.length"
          class="flex flex-wrap gap-2"
        >
          <li
            v-for="mod in mods"
            :key="mod.key"
            class="chip text-moss-100"
          >
            <UIcon
              :name="mod.icon"
              class="size-4 text-sun-300"
            />
            {{ t(`mods.${mod.key}`) }}
          </li>
        </ul>

        <motion.div
          v-if="props.level.newPlant || props.level.newRobot"
          :initial="reduced ? false : { scale: 0.8, opacity: 0 }"
          :animate="{ scale: 1, opacity: 1 }"
          :transition="{ type: 'spring', stiffness: 300, damping: 14, delay: 0.25 }"
          class="flex items-center gap-3 rounded-2xl p-3"
          :class="props.level.newPlant ? 'bg-leaf-500/20 ring-1 ring-leaf-400/50' : 'bg-berry/15 ring-1 ring-berry/50'"
        >
          <SpriteIcon
            :name="props.level.newPlant ? PLANTS[props.level.newPlant].sprite : ROBOTS[props.level.newRobot!].sprite"
            class="size-16 shrink-0"
          />
          <div>
            <p
              class="text-xs font-bold uppercase tracking-wide"
              :class="props.level.newPlant ? 'text-leaf-300' : 'text-berry'"
            >
              {{ props.level.newPlant ? t('level.newPlant') : t('level.newRobot') }}
            </p>
            <p class="font-display text-xl leading-tight">
              {{ props.level.newPlant ? t(`plants.${props.level.newPlant}.name`) : t(`robots.${props.level.newRobot}.name`) }}
            </p>
            <p class="text-sm text-moss-200">
              {{ props.level.newPlant ? t(`plants.${props.level.newPlant}.desc`) : t(`robots.${props.level.newRobot}.desc`) }}
            </p>
          </div>
        </motion.div>

        <div>
          <p class="mb-1 text-sm font-semibold text-moss-200">
            {{ t('level.robots') }}
          </p>
          <ul class="flex flex-wrap gap-2">
            <li
              v-for="id in robots"
              :key="id"
              class="flex size-14 items-center justify-center rounded-xl bg-moss-950/60 p-1"
              :title="`${t(`robots.${id}.name`)}: ${t(`robots.${id}.desc`)}`"
            >
              <SpriteIcon
                :name="ROBOTS[id].sprite"
                class="size-full"
              />
              <span class="sr-only">{{ t(`robots.${id}.name`) }}</span>
            </li>
          </ul>
        </div>
      </motion.section>

      <motion.section
        v-bind="pop(0.12)"
        class="glass flex flex-col gap-3 p-4"
      >
        <div class="flex items-center gap-2">
          <p class="me-auto font-semibold">
            {{ choosing ? t('level.pick', { n: localNumber(props.level.slots, locale) }) : t('level.seeds') }}
          </p>
          <span
            v-if="choosing"
            class="chip"
          >{{ t('level.picked', { n: localNumber(loadout.length, locale), max: localNumber(props.level.slots, locale) }) }}</span>
          <UButton
            v-if="choosing"
            :label="t('level.auto')"
            icon="i-lucide-wand-sparkles"
            size="sm"
            color="neutral"
            variant="subtle"
            @click="suggest"
          />
        </div>
        <ul class="grid grid-cols-4 gap-2 sm:grid-cols-6">
          <li
            v-for="id in props.level.plants"
            :key="id"
          >
            <button
              type="button"
              class="relative flex w-full flex-col items-center rounded-xl p-1 transition"
              :class="[
                loadout.includes(id) ? 'bg-leaf-500/25 ring-2 ring-sun-300' : 'bg-moss-950/50 ring-1 ring-moss-700',
                allowed(id) ? '' : 'opacity-35 grayscale',
                choosing ? 'cursor-pointer active:scale-95' : 'cursor-default',
              ]"
              :aria-pressed="loadout.includes(id)"
              :disabled="!choosing"
              :title="`${t(`plants.${id}.name`)}: ${t(`plants.${id}.desc`)}`"
              @click="toggle(id)"
            >
              <SpriteIcon
                :name="PLANTS[id].sprite"
                class="size-12"
              />
              <span class="flex items-center gap-0.5 font-display text-sm text-sun-200">
                <UIcon
                  name="i-lucide-droplet"
                  class="size-3 text-dew"
                />
                {{ localNumber(PLANTS[id].cost, locale) }}
              </span>
              <span class="sr-only">{{ t(`plants.${id}.name`) }}</span>
              <UIcon
                v-if="loadout.includes(id)"
                name="i-lucide-check"
                class="absolute -end-1 -top-1 size-5 rounded-full bg-sun-300 p-0.5 text-sun-950"
              />
            </button>
          </li>
        </ul>
        <p
          v-if="props.level.noProducers"
          class="text-sm text-sun-200"
        >
          {{ t('level.noProducers') }}
        </p>
      </motion.section>
    </div>

    <motion.div
      v-bind="pop(0.18)"
      class="flex justify-center"
    >
      <button
        type="button"
        class="btn-game lg min-w-60"
        :disabled="loadout.length === 0"
        @click="emit('start')"
      >
        <UIcon
          name="i-lucide-sprout"
          class="size-7"
        />
        {{ t('level.start') }}
      </button>
    </motion.div>
  </div>
</template>
