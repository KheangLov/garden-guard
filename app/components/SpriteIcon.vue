<script setup lang="ts">
/**
 * A game character, good or building. In the browser it's a picture of the 3D model (rendered once
 * by app/game/three/icons.ts); before that, on the server, or without WebGL, it's the flat drawing.
 */
import { spriteSvg, type SpriteName } from '#shared/game'
import { ensureIcons, iconUrl } from '~/game/three/icons'
import type { ModelName } from '~/game/three/models'

const props = defineProps<{ name: SpriteName }>()

const MODELS = new Set<string>([
  'bulb', 'moonbulb', 'chili', 'twin', 'mint', 'bamboo', 'lotus', 'pumpkin', 'sugarpalm', 'corn', 'coconut', 'coconutSleep',
  'durian', 'bot', 'brute', 'mini', 'drone', 'pogo', 'shield', 'tank', 'boss', 'cart', 'dew', 'dara', 'yay', 'mealea',
])
const cache = new Map<SpriteName, string>()
const svg = computed(() => {
  let s = cache.get(props.name)
  if (!s) {
    s = spriteSvg(props.name, 'size-full overflow-visible')
    cache.set(props.name, s)
  }
  return s
})

const src = ref<string | null>(null)
async function load() {
  const name = props.name
  if (!MODELS.has(name)) {
    src.value = null
    return
  }
  src.value = iconUrl(name as ModelName)
  if (src.value) return
  await ensureIcons([name as ModelName])
  if (props.name === name) src.value = iconUrl(name as ModelName)
}
onMounted(load)
watch(() => props.name, load)
</script>

<template>
  <img
    v-if="src"
    :src="src"
    alt=""
    class="inline-block object-contain drop-shadow-[0_3px_3px_rgb(0_0_0/0.25)]"
    draggable="false"
  >
  <!-- The markup is generated from the game's own sprite data, never from anything a player typed. -->
  <!-- eslint-disable vue/no-v-html -->
  <span
    v-else
    class="inline-block"
    aria-hidden="true"
    v-html="svg"
  />
  <!-- eslint-enable vue/no-v-html -->
</template>
