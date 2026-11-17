<script setup lang="ts">
import { motion } from 'motion-v'
import { TOTAL_LEVELS, levelLabel } from '#shared/game'

const { locale, t } = useI18n()
const gateway = useGateway()
const progress = useProgressStore()
const reduced = useReducedMotion()
const settingsOpen = ref(false)

const n = (value: number) => localNumber(value, locale.value)
const nextLevel = computed(() => progress.unlocked)
const playLabel = computed(() => {
  if (!progress.loaded || progress.cleared === 0) return t('home.start')
  return t('home.continue', { level: localDigits(levelLabel(nextLevel.value), locale.value) })
})

/** The hero's cast: guardians on the left, robots on the right, each bobbing on its own beat. */
const heroes = [
  { name: 'bulb', size: 'size-12 sm:size-24 landscape:max-lg:size-14', delay: 0 },
  { name: 'chili', size: 'size-14 sm:size-28 landscape:max-lg:size-16', delay: 0.4 },
  { name: 'pumpkin', size: 'size-12 sm:size-24 landscape:max-lg:size-14', delay: 0.8 },
] as const
const robots = [
  { name: 'drone', size: 'size-10 sm:size-20 landscape:max-lg:size-12', delay: 0.2, lift: -30 },
  { name: 'bot', size: 'size-14 sm:size-28 landscape:max-lg:size-16', delay: 0.6, lift: 0 },
  { name: 'brute', size: 'size-14 sm:size-28 landscape:max-lg:size-16', delay: 1, lift: 0 },
] as const

const float = (delay: number) => reduced.value
  ? {}
  : { animate: { y: [0, -8, 0] }, transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' as const, delay } }
</script>

<template>
  <main class="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 pb-[calc(1.5rem+var(--safe-bottom))] pe-[calc(1rem+var(--safe-right))] ps-[calc(1rem+var(--safe-left))] pt-[calc(1rem+var(--safe-top))]">
    <header class="flex items-center justify-end gap-2">
      <UButton
        v-if="gateway.inGateway"
        :label="t('home.allGames')"
        icon="i-lucide-layout-grid"
        color="neutral"
        variant="subtle"
        class="me-auto"
        @click="gateway.exit()"
      />
      <PwaInstallButton v-if="!gateway.inGateway" />
      <button
        type="button"
        class="btn-icon"
        :aria-label="t('home.settings')"
        @click="settingsOpen = true"
      >
        <UIcon
          name="i-lucide-settings"
          class="size-5"
        />
      </button>
    </header>

    <section class="flex flex-1 flex-col items-center justify-center gap-6 text-center landscape:max-lg:gap-3">
      <motion.div
        :initial="reduced ? false : { opacity: 0, y: 24, scale: 0.94 }"
        :animate="{ opacity: 1, y: 0, scale: 1 }"
        :transition="{ type: 'spring', stiffness: 160, damping: 16 }"
        class="flex flex-col items-center gap-1"
      >
        <p class="chip text-leaf-200">
          <UIcon
            name="i-lucide-sprout"
            class="size-4"
          />
          {{ t('app.subtitle') }}
        </p>
        <h1 class="text-glow font-display text-6xl leading-[1.15] sm:text-7xl landscape:max-lg:text-5xl">
          {{ t('app.title') }}
        </h1>
        <p class="max-w-md text-balance text-moss-200">
          {{ t('app.tagline') }}
        </p>
      </motion.div>

      <div
        class="flex w-full max-w-3xl items-end justify-between gap-1 overflow-x-clip px-0 sm:gap-2 sm:px-2 landscape:max-lg:max-w-xl"
        aria-hidden="true"
      >
        <div class="flex items-end gap-1 sm:gap-3">
          <motion.div
            v-for="(hero, i) in heroes"
            :key="hero.name"
            :initial="reduced ? false : { opacity: 0, x: -60, scale: 0.6 }"
            :animate="{ opacity: 1, x: 0, scale: 1 }"
            :transition="{ type: 'spring', stiffness: 220, damping: 15, delay: 0.15 + i * 0.12 }"
          >
            <motion.div v-bind="float(hero.delay)">
              <SpriteIcon
                :name="hero.name"
                :class="hero.size"
              />
            </motion.div>
          </motion.div>
        </div>
        <motion.div
          :initial="reduced ? false : { scale: 0, rotate: -20 }"
          :animate="{ scale: 1, rotate: 0 }"
          :transition="{ type: 'spring', stiffness: 260, damping: 12, delay: 0.6 }"
          class="mb-6 font-display text-3xl text-sun-300 sm:text-4xl"
        >
          VS
        </motion.div>
        <div class="flex items-end gap-1 sm:gap-3">
          <motion.div
            v-for="(robot, i) in robots"
            :key="robot.name"
            :initial="reduced ? false : { opacity: 0, x: 60, scale: 0.6 }"
            :animate="{ opacity: 1, x: 0, scale: 1 }"
            :transition="{ type: 'spring', stiffness: 220, damping: 15, delay: 0.3 + i * 0.12 }"
            :style="{ marginBottom: `${-robot.lift}px` }"
          >
            <motion.div v-bind="float(robot.delay)">
              <SpriteIcon
                :name="robot.name"
                :class="robot.size"
              />
            </motion.div>
          </motion.div>
        </div>
      </div>

      <motion.div
        :initial="reduced ? false : { opacity: 0, y: 30 }"
        :animate="{ opacity: 1, y: 0 }"
        :transition="{ type: 'spring', stiffness: 180, damping: 18, delay: 0.5 }"
        class="flex w-full max-w-sm flex-col items-stretch gap-3 landscape:max-lg:max-w-2xl landscape:max-lg:flex-row landscape:max-lg:flex-wrap landscape:max-lg:justify-center"
      >
        <NuxtLink
          :to="`/play/${nextLevel}`"
          class="btn-game lg"
        >
          <UIcon
            name="i-lucide-play"
            class="size-7"
          />
          {{ playLabel }}
        </NuxtLink>
        <NuxtLink
          to="/map"
          class="btn-game ghost"
        >
          <UIcon
            name="i-lucide-map"
            class="size-5"
          />
          {{ t('home.levels') }}
        </NuxtLink>
        <div
          v-if="progress.loaded"
          class="flex flex-wrap justify-center gap-2 text-sm"
        >
          <span class="chip text-sun-200">
            <UIcon
              name="i-lucide-star"
              class="size-4 fill-sun-300 text-sun-400"
            />
            {{ t('home.stars', { n: n(progress.totalStars), total: n(TOTAL_LEVELS * 3) }) }}
          </span>
          <span class="chip text-leaf-200">
            <UIcon
              name="i-lucide-flag"
              class="size-4"
            />
            {{ t('home.cleared', { n: n(progress.cleared), total: n(TOTAL_LEVELS) }) }}
          </span>
        </div>
        <p
          v-if="progress.allDone"
          class="text-sm text-sun-200"
        >
          {{ t('home.allDone') }}
        </p>
      </motion.div>
    </section>

    <details class="glass group mx-auto w-full max-w-xl px-4 py-3 text-sm landscape:max-lg:hidden">
      <summary class="flex min-h-8 cursor-pointer list-none items-center justify-between font-medium">
        {{ t('home.howTitle') }}
        <UIcon
          name="i-lucide-chevron-down"
          class="size-4 transition group-open:rotate-180"
        />
      </summary>
      <ol class="mt-2 list-decimal space-y-1.5 ps-5 leading-relaxed text-muted">
        <li>{{ t('home.how1') }}</li>
        <li>{{ t('home.how2') }}</li>
        <li>{{ t('home.how3') }}</li>
      </ol>
    </details>

    <SettingsModal v-model:open="settingsOpen" />
  </main>
</template>
