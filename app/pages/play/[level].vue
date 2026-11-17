<script setup lang="ts">
/**
 * One level, from start to finish: the world's story (first time), the briefing and seed choice,
 * the game itself with its top bar, and the result. Going to the next level reuses this page.
 */
import { AnimatePresence, motion } from 'motion-v'
import {
  Engine, PLANTS, TOTAL_LEVELS, WORLDS, getLevel, levelLabel, suggestedLoadout,
  type GameEvent, type LevelDef, type PlantId,
} from '#shared/game'
import { buzz } from '~/game/audio'
import type GameBoard from '~/components/game/GameBoard.vue'
import type SeedBar from '~/components/game/SeedBar.vue'

type Phase = 'loading' | 'storyIntro' | 'briefing' | 'playing' | 'storyOutro' | 'result'

const route = useRoute()
const router = useRouter()
const { locale, t } = useI18n()
const progress = useProgressStore()
const reduced = useReducedMotion()
const audio = useGameAudio()

const phase = ref<Phase>('loading')
/** Whether the garden is on screen (the menus' 3D backdrop rests meanwhile). */
const playing = useState('playing', () => false)
watch(phase, p => (playing.value = p === 'playing' || p === 'result' || p === 'storyOutro'), { immediate: true })
const level = shallowRef<LevelDef>(getLevel(1))
const loadout = ref<PlantId[]>([])
const engine = shallowRef<Engine | null>(null)
const selection = ref<PlantId | 'shovel' | null>(null)
const paused = ref(false)
const speed = ref(1)
const settingsOpen = ref(false)
const board = ref<InstanceType<typeof GameBoard> | null>(null)
const seedBar = ref<InstanceType<typeof SeedBar> | null>(null)
const progressFill = ref<HTMLElement | null>(null)
const bossFill = ref<HTMLElement | null>(null)

// Top bar values that change now and then (updated from the frame loop only when they change).
const dew = ref(0)
const dewBump = ref(0)
const wave = ref(0)
const bossOn = ref(false)

const n = (value: number) => localNumber(value, locale.value)
const world = computed(() => WORLDS[level.value.world]!)
const label = computed(() => localDigits(levelLabel(level.value.n), locale.value))
const waveFlags = computed(() => {
  const last = level.value.spawns[level.value.spawns.length - 1]?.t ?? 1
  return level.value.waves.map(w => ({ at: Math.min(1, w.at / last), huge: w.huge }))
})

useHead({ title: () => `${t('app.title')} · ${levelLabel(level.value.n)}` })

/* ------------------------------ Banners and hints ------------------------------ */

interface Banner { id: number, text: string, tone: 'sun' | 'berry' | 'leaf', big: boolean }
const banner = ref<Banner | null>(null)
let bannerTimer: ReturnType<typeof setTimeout> | undefined
let bannerId = 0
function showBanner(text: string, tone: Banner['tone'] = 'sun', ms = 1800, big = true) {
  clearTimeout(bannerTimer)
  banner.value = { id: ++bannerId, text, tone, big }
  bannerTimer = setTimeout(() => (banner.value = null), ms)
}
function bannerSequence(items: [string, Banner['tone'], number][]) {
  let delay = 0
  for (const [text, tone, ms] of items) {
    setTimeout(() => phase.value === 'playing' && showBanner(text, tone, ms), delay)
    delay += ms
  }
}

const hint = ref<string | null>(null)
const tutorialStep = ref(0)
function updateHint() {
  if (level.value.n === 1) {
    hint.value = (['hints.pickBulb', 'hints.collect', 'hints.pickChili', 'hints.goodJob'] as const)[tutorialStep.value] ?? null
  }
}

/* ------------------------------ Flow ------------------------------ */

function init() {
  const num = Number(route.params.level)
  if (!Number.isInteger(num) || num < 1 || num > TOTAL_LEVELS) {
    void router.replace('/map')
    return
  }
  progress.load()
  if (!progress.isUnlocked(num)) {
    void router.replace('/map')
    return
  }
  level.value = getLevel(num)
  engine.value = null
  selection.value = null
  paused.value = false
  banner.value = null
  hint.value = null
  tutorialStep.value = 0
  loadout.value = suggestedLoadout(level.value, progress.loadout)
  const introId = `${world.value.id}-intro`
  phase.value = level.value.index === 0 && !progress.seen.includes(introId) ? 'storyIntro' : 'briefing'
}

function start() {
  if (!loadout.value.length) return
  progress.setLoadout(loadout.value)
  const e = new Engine(level.value, loadout.value)
  e.autoCollect = progress.settings.autoCollect
  engine.value = markRaw(e)
  dew.value = e.dew
  wave.value = 0
  bossOn.value = false
  selection.value = null
  paused.value = false
  phase.value = 'playing'
  audio?.unlock()
  audio?.playMusic(level.value.world)
  audio?.duck(false)
  bannerSequence([[t('game.ready'), 'leaf', 700], [t('game.set'), 'leaf', 700], [t('game.plant'), 'sun', 1000]])
  if (level.value.n === 1) setTimeout(updateHint, 2400)
  if (level.value.n === 2) setTimeout(() => (hint.value = 'hints.drag'), 2400)
}

function restart() {
  paused.value = false
  start()
}

function finish() {
  const e = engine.value
  if (!e) return
  audio?.duck(true)
  if (e.state === 'won') {
    progress.complete(level.value.n, e.stars)
    const outro = `${world.value.id}-outro`
    if (level.value.kind === 'boss' && !progress.seen.includes(outro)) {
      phase.value = 'storyOutro'
      return
    }
  }
  phase.value = 'result'
}

function nextLevel() {
  void router.push(`/play/${level.value.n + 1}`)
}

function toLevels() {
  void router.push({ path: '/map' })
}

function exitBriefing() {
  void router.push('/map')
}

/* ------------------------------ Playing ------------------------------ */

function haptic(ms: number | number[]) {
  if (progress.settings.haptics) buzz(ms)
}

function select(id: PlantId) {
  if (board.value?.wasDrag()) return
  const e = engine.value
  if (!e || paused.value) return
  if (selection.value === id) {
    selection.value = null
    return
  }
  if (!e.seedReady(id)) {
    audio?.ui('nope')
    if (e.dew < PLANTS[id].cost) showBanner(t('game.notEnough'), 'berry', 900, false)
    return
  }
  audio?.ui('select')
  selection.value = id
}

function cardDrag(id: PlantId, event: PointerEvent) {
  if (engine.value?.seedReady(id) && !paused.value) board.value?.startDrag(id, event)
}

function toggleShovel() {
  audio?.ui('tap')
  selection.value = selection.value === 'shovel' ? null : 'shovel'
}

function onTile(r: number, c: number, seed?: PlantId) {
  const e = engine.value
  const s = seed ?? selection.value
  if (!e || !s) return
  if (s === 'shovel') {
    if (e.dig(r, c)) {
      haptic(15)
      selection.value = null
    }
    else audio?.ui('nope')
    return
  }
  const check = e.canPlant(s, r, c)
  if (check === 'ok') {
    e.plant(s, r, c)
    haptic(15)
    selection.value = null
    return
  }
  audio?.ui('nope')
  haptic([10, 40, 10])
  if (check === 'cost') showBanner(t('game.notEnough'), 'berry', 900, false)
}

function onEvents(events: GameEvent[]) {
  const e = engine.value!
  audio?.handle(events, e.time)
  for (const ev of events) {
    switch (ev.type) {
      case 'wave':
        if (ev.huge) showBanner(t('game.hugeWave'), 'berry', 2600)
        else if (ev.wave === 1) showBanner(t('game.waveIn'), 'sun', 1600)
        if (ev.final && ev.huge) setTimeout(() => phase.value === 'playing' && showBanner(t('game.finalWave'), 'berry', 1600), 2800)
        break
      case 'robotIn':
        if (ev.robot === 'boss') showBanner(t('game.bossHere'), 'berry', 2400)
        break
      case 'cart':
        haptic(40)
        break
      case 'explode':
        haptic(ev.kind === 'boss' ? [60, 40, 120] : 50)
        break
      case 'plant':
        if (level.value.n === 1) {
          if (ev.plant === 'bulb' && tutorialStep.value === 0) tutorialStep.value = 1
          if (ev.plant === 'chili' && tutorialStep.value <= 2) {
            tutorialStep.value = 3
            setTimeout(() => (hint.value = null), 3500)
          }
          updateHint()
        }
        break
      case 'collect':
        if (level.value.n === 1 && tutorialStep.value === 1) {
          tutorialStep.value = 2
          updateHint()
        }
        break
      case 'won':
        hint.value = null
        haptic([30, 60, 30, 60, 80])
        setTimeout(finish, 1600)
        break
      case 'lost':
        hint.value = null
        haptic(300)
        setTimeout(finish, 1300)
        break
    }
  }
  if (level.value.n === 2 && hint.value === 'hints.drag' && e.time > 14) hint.value = null
}

let lastSync = { dew: -1, wave: -1, boss: false, progress: -1, bossHp: -1 }
function onFrame() {
  const e = engine.value
  if (!e) return
  seedBar.value?.sync()
  if (e.dew !== lastSync.dew) {
    if (e.dew > lastSync.dew && lastSync.dew >= 0) dewBump.value++
    dew.value = e.dew
    lastSync.dew = e.dew
  }
  if (e.wave !== lastSync.wave) wave.value = lastSync.wave = e.wave
  const p = Math.round(e.progress * 1000) / 10
  if (p !== lastSync.progress && progressFill.value) {
    progressFill.value.style.width = `${p}%`
    lastSync.progress = p
  }
  const boss = !!e.boss && !e.boss.dying
  if (boss !== lastSync.boss) bossOn.value = lastSync.boss = boss
  if (e.boss && bossFill.value) {
    const hp = Math.round((Math.max(0, e.boss.hp) / e.boss.max) * 1000) / 10
    if (hp !== lastSync.bossHp) {
      bossFill.value.style.width = `${hp}%`
      lastSync.bossHp = hp
    }
  }
}
watch(engine, () => (lastSync = { dew: -1, wave: -1, boss: false, progress: -1, bossHp: -1 }))

function togglePause() {
  if (phase.value !== 'playing' || engine.value?.state !== 'playing') return
  paused.value = !paused.value
  audio?.ui('tap')
  audio?.duck(paused.value)
}

function toggleSpeed() {
  speed.value = speed.value === 1 ? 2 : 1
  audio?.ui('tap')
}

function onKey(event: KeyboardEvent) {
  if (phase.value !== 'playing' || settingsOpen.value) return
  const e = engine.value
  if (!e) return
  if (event.key === 'Escape') {
    if (selection.value) selection.value = null
    else togglePause()
    return
  }
  if (event.key === ' ' || event.key === 'p' || event.key === 'P') {
    event.preventDefault()
    togglePause()
    return
  }
  if (paused.value) return
  const digit = Number(event.key)
  if (digit >= 1 && digit <= e.loadout.length) select(e.loadout[digit - 1]!)
  else if (event.key === 's' || event.key === 'S') toggleShovel()
  else if (event.key === 'f' || event.key === 'F') toggleSpeed()
}

function onSettingChange(key: string, value: boolean) {
  if (key === 'autoCollect' && engine.value) engine.value.autoCollect = value
  if (key === 'music') audio?.setMusic(value, level.value.world)
}

function onVisibility() {
  if (document.hidden && phase.value === 'playing' && !paused.value && engine.value?.state === 'playing') {
    paused.value = true
    audio?.duck(true)
  }
}

watch(() => route.params.level, () => {
  if (route.path.startsWith('/play/')) init()
})

onMounted(() => {
  init()
  window.addEventListener('keydown', onKey)
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  playing.value = false
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('visibilitychange', onVisibility)
  clearTimeout(bannerTimer)
  audio?.stopMusic()
})
</script>

<template>
  <div class="fixed inset-0 flex flex-col overflow-hidden">
    <!-- Story before a world's first level, and after its boss. -->
    <StoryScene
      v-if="phase === 'storyIntro'"
      :world="world.id"
      part="intro"
      @done="phase = 'briefing'"
    />
    <StoryScene
      v-if="phase === 'storyOutro'"
      :world="world.id"
      part="outro"
      @done="phase = 'result'"
    />

    <div
      v-if="phase === 'briefing'"
      class="flex-1 overflow-y-auto"
    >
      <GameLevelBriefing
        v-model:loadout="loadout"
        :level="level"
        @start="start"
        @back="exitBriefing"
      />
    </div>

    <template v-if="engine && (phase === 'playing' || phase === 'result' || phase === 'storyOutro')">
      <!-- Top bar: pause, dew, seeds, shovel, speed, progress. -->
      <header
        class="flex shrink-0 items-center gap-2 px-[calc(0.5rem+var(--safe-left))] pe-[calc(0.5rem+var(--safe-right))] pt-[calc(0.4rem+var(--safe-top))] pb-1.5 [--card-w:clamp(2.6rem,10.5vh,4.3rem)] sm:gap-3"
      >
        <button
          type="button"
          class="btn-icon shrink-0"
          :aria-label="t('game.pause')"
          @click="togglePause"
        >
          <UIcon
            name="i-lucide-pause"
            class="size-5"
          />
        </button>
        <div
          class="flex shrink-0 flex-col items-center justify-center rounded-2xl border-3 border-[#4e2e14] bg-[#fff7e0] px-2 py-1 shadow-[0_3px_0_#2e1a0a]"
          :style="{ width: 'calc(var(--card-w) * 1.05)', height: 'calc(var(--card-w) * 1.18)' }"
          role="status"
          :aria-label="`${t('game.dew')}: ${dew}`"
        >
          <SpriteIcon
            name="dew"
            class="size-[55%]"
          />
          <motion.span
            :key="dewBump"
            :initial="reduced ? false : { scale: 1.35, color: '#1aa0e0' }"
            :animate="{ scale: 1, color: '#0b5c87' }"
            :transition="{ type: 'spring', stiffness: 500, damping: 18 }"
            class="font-display text-[calc(var(--card-w)*0.3)] leading-none"
          >
            {{ n(dew) }}
          </motion.span>
        </div>
        <div class="min-w-0 overflow-x-auto overflow-y-visible py-1.5 [scrollbar-width:none]">
          <GameSeedBar
            ref="seedBar"
            :engine="engine"
            :selection="selection"
            @select="select"
            @shovel="toggleShovel"
            @drag="cardDrag"
          />
        </div>
        <div class="ms-auto flex shrink-0 items-center gap-2">
          <div class="hidden flex-col items-end gap-2.5 sm:flex landscape:flex">
            <span class="text-xs font-semibold text-moss-200">
              {{ label }} · {{ wave ? t('game.wave', { n: n(wave), total: n(level.waves.length) }) : t('game.getReady') }}
            </span>
            <div class="relative h-3 w-28 rounded-full bg-moss-950 ring-2 ring-moss-600 sm:w-40">
              <div
                ref="progressFill"
                class="h-full w-0 rounded-full bg-gradient-to-r from-leaf-500 to-leaf-300 transition-[width] duration-300"
              />
              <UIcon
                v-for="(flag, i) in waveFlags"
                :key="i"
                name="i-lucide-flag"
                class="absolute -top-2.5 size-3"
                :class="flag.huge ? 'text-berry' : 'text-sun-300'"
                :style="{ left: `calc(${flag.at * 100}% - 4px)` }"
              />
            </div>
          </div>
          <button
            type="button"
            class="btn-icon"
            :aria-pressed="speed === 2"
            :aria-label="t('game.speed', { n: n(speed === 1 ? 2 : 1) })"
            @click="toggleSpeed"
          >
            <UIcon
              name="i-lucide-fast-forward"
              class="size-5"
            />
          </button>
        </div>
      </header>

      <main class="relative min-h-0 flex-1 px-[calc(0.5rem+var(--safe-left))] pe-[calc(0.5rem+var(--safe-right))] pb-[calc(0.5rem+var(--safe-bottom))]">
        <GameBoard
          ref="board"
          :engine="engine"
          :selection="selection"
          :paused="paused || phase !== 'playing'"
          :speed="speed"
          :on-tile="onTile"
          :on-events="onEvents"
          :on-frame="onFrame"
        />

        <!-- The boss's health. -->
        <AnimatePresence>
          <motion.div
            v-if="bossOn"
            :initial="reduced ? false : { y: -30, opacity: 0 }"
            :animate="{ y: 0, opacity: 1 }"
            :exit="{ y: -30, opacity: 0 }"
            class="pointer-events-none absolute inset-x-0 top-2 mx-auto flex w-[min(28rem,70%)] items-center gap-2 rounded-full bg-moss-950/80 p-1.5 pe-3 ring-2 ring-berry/60"
          >
            <SpriteIcon
              name="boss"
              class="size-8"
            />
            <span class="font-display text-sm text-[#ff9db0]">{{ t('robots.boss.name') }}</span>
            <div class="h-3 flex-1 overflow-hidden rounded-full bg-moss-900">
              <div
                ref="bossFill"
                class="h-full w-full rounded-full bg-gradient-to-r from-berry to-[#ff9db0] transition-[width] duration-200"
              />
            </div>
          </motion.div>
        </AnimatePresence>

        <!-- Wave announcements. -->
        <div
          class="pointer-events-none absolute inset-0 flex items-center justify-center"
          aria-live="assertive"
        >
          <AnimatePresence>
            <motion.p
              v-if="banner"
              :key="banner.id"
              :initial="reduced ? { opacity: 0 } : { scale: 0.4, opacity: 0, rotate: -6 }"
              :animate="{ scale: 1, opacity: 1, rotate: 0 }"
              :exit="reduced ? { opacity: 0 } : { scale: 1.3, opacity: 0 }"
              :transition="{ type: 'spring', stiffness: 400, damping: 20 }"
              class="px-4 text-center font-display leading-tight"
              :class="[
                banner.big ? 'text-5xl sm:text-7xl' : 'text-3xl',
                banner.tone === 'berry' ? 'text-[#ffd1dc] [text-shadow:0_4px_0_#7a1030,0_0_30px_rgb(255_77_109/0.7)]'
                : banner.tone === 'leaf' ? 'text-leaf-100 [text-shadow:0_4px_0_#29491c,0_0_30px_rgb(120_204_69/0.7)]'
                  : 'text-sun-100 [text-shadow:0_4px_0_#7a340d,0_0_30px_rgb(255_190_31/0.7)]',
              ]"
            >
              {{ banner.text }}
            </motion.p>
          </AnimatePresence>
        </div>

        <!-- Tutorial hints. -->
        <AnimatePresence>
          <motion.div
            v-if="hint && phase === 'playing'"
            :key="hint"
            :initial="reduced ? false : { y: 30, opacity: 0 }"
            :animate="{ y: 0, opacity: 1 }"
            :exit="{ y: 30, opacity: 0 }"
            class="pointer-events-none absolute inset-x-0 bottom-4 mx-auto flex w-fit max-w-[90%] items-center gap-2 rounded-2xl bg-sun-300 px-4 py-2 font-semibold text-sun-950 shadow-xl"
            role="status"
          >
            <UIcon
              name="i-lucide-hand"
              class="size-5 shrink-0"
            />
            {{ t(hint) }}
          </motion.div>
        </AnimatePresence>
      </main>

      <!-- Pause menu. -->
      <AnimatePresence>
        <motion.div
          v-if="paused && phase === 'playing'"
          :initial="{ opacity: 0 }"
          :animate="{ opacity: 1 }"
          :exit="{ opacity: 0 }"
          class="fixed inset-0 z-40 flex items-center justify-center bg-moss-950/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          :aria-label="t('pause.title')"
        >
          <motion.div
            :initial="reduced ? false : { scale: 0.85, y: 20 }"
            :animate="{ scale: 1, y: 0 }"
            :transition="{ type: 'spring', stiffness: 300, damping: 22 }"
            class="glass flex w-full max-w-xs flex-col gap-3 p-6 text-center"
          >
            <h2 class="text-glow font-display text-4xl">
              {{ t('pause.title') }}
            </h2>
            <p class="text-sm text-muted">
              {{ t(`worlds.${world.id}.name`) }} · {{ label }}
            </p>
            <button
              type="button"
              class="btn-game"
              @click="togglePause"
            >
              <UIcon
                name="i-lucide-play"
                class="size-5"
              />
              {{ t('pause.resume') }}
            </button>
            <button
              type="button"
              class="btn-game ghost"
              @click="restart"
            >
              <UIcon
                name="i-lucide-rotate-ccw"
                class="size-5"
              />
              {{ t('pause.restart') }}
            </button>
            <div class="flex gap-3">
              <button
                type="button"
                class="btn-game ghost flex-1"
                @click="toLevels"
              >
                <UIcon
                  name="i-lucide-map"
                  class="size-5"
                />
                {{ t('pause.quit') }}
              </button>
              <button
                type="button"
                class="btn-game ghost"
                :aria-label="t('settings.title')"
                @click="settingsOpen = true"
              >
                <UIcon
                  name="i-lucide-settings"
                  class="size-5"
                />
              </button>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>

      <GameResultSheet
        v-if="phase === 'result'"
        :engine="engine"
        @next="nextLevel"
        @replay="restart"
        @levels="toLevels"
      />
    </template>

    <SettingsModal
      v-model:open="settingsOpen"
      @change="onSettingChange"
    />
  </div>
</template>
