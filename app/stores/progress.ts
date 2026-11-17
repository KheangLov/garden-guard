import { defineStore } from 'pinia'
import { LEVELS_PER_WORLD, PLANT_ORDER, TOTAL_LEVELS, type PlantId } from '#shared/game'

/** Where progress and settings are kept (this device only; nothing is sent anywhere). */
export const STORAGE_KEY = 'garden-guard:v1'

export interface Settings {
  sound: boolean
  music: boolean
  haptics: boolean
  /** Shadows, smooth edges and sharp pixels (off: faster on older phones). */
  hd: boolean
  /** Dew collects itself (handy on small screens, or for younger players). */
  autoCollect: boolean
}

interface Saved {
  /** Best stars per level (index = level number; 0 = not cleared). */
  stars: number[]
  /** Story scenes already seen, e.g. 'backyard-intro'. */
  seen: string[]
  loadout: PlantId[]
  settings: Settings
}

const DEFAULT_SETTINGS: Settings = { sound: true, music: true, haptics: true, autoCollect: false, hd: true }

export const useProgressStore = defineStore('progress', () => {
  const loaded = ref(false)
  const stars = ref<number[]>(Array(TOTAL_LEVELS + 1).fill(0))
  const seen = ref<string[]>([])
  const loadout = ref<PlantId[]>([])
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS })

  /** The furthest level you can play: one past the furthest cleared. */
  const unlocked = computed(() => {
    let n = 1
    while (n <= TOTAL_LEVELS && stars.value[n]! > 0) n++
    return Math.min(n, TOTAL_LEVELS)
  })
  const cleared = computed(() => stars.value.filter(s => s > 0).length)
  const totalStars = computed(() => stars.value.reduce((a, b) => a + b, 0))
  const allDone = computed(() => cleared.value >= TOTAL_LEVELS)

  function worldStars(world: number) {
    let sum = 0
    for (let n = world * LEVELS_PER_WORLD + 1; n <= (world + 1) * LEVELS_PER_WORLD; n++) sum += stars.value[n]!
    return sum
  }
  function isUnlocked(n: number) {
    return n >= 1 && n <= unlocked.value
  }

  function load() {
    if (loaded.value || !import.meta.client) return
    loaded.value = true
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as Partial<Saved>
      if (Array.isArray(saved.stars)) {
        stars.value = Array.from({ length: TOTAL_LEVELS + 1 }, (_, i) => Math.max(0, Math.min(3, Number(saved.stars![i]) || 0)))
      }
      if (Array.isArray(saved.seen)) seen.value = saved.seen.filter(s => typeof s === 'string')
      if (Array.isArray(saved.loadout)) loadout.value = saved.loadout.filter((id): id is PlantId => PLANT_ORDER.includes(id as PlantId))
      if (saved.settings && typeof saved.settings === 'object') settings.value = { ...DEFAULT_SETTINGS, ...saved.settings }
    }
    catch {
      // Unreadable or blocked storage: start fresh.
    }
  }

  function save() {
    if (!import.meta.client) return
    try {
      const data: Saved = { stars: stars.value, seen: seen.value, loadout: loadout.value, settings: settings.value }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    }
    catch {
      // Storage full or blocked: progress lasts for this visit only.
    }
  }

  /** Records a cleared level. Returns whether it was the first time. */
  function complete(n: number, got: number) {
    const first = stars.value[n] === 0
    if (got > stars.value[n]!) stars.value[n] = got
    save()
    return first
  }

  function markSeen(id: string) {
    if (!seen.value.includes(id)) {
      seen.value.push(id)
      save()
    }
  }

  function setLoadout(ids: PlantId[]) {
    loadout.value = [...ids]
    save()
  }

  function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    settings.value[key] = value
    save()
  }

  function reset() {
    stars.value = Array(TOTAL_LEVELS + 1).fill(0)
    seen.value = []
    loadout.value = []
    save()
  }

  return { loaded, stars, seen, loadout, settings, unlocked, cleared, totalStars, allDone, worldStars, isUnlocked, load, save, complete, markSeen, setLoadout, setSetting, reset }
})
