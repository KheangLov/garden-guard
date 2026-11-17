<script setup lang="ts">
/** A game character or prop as inline SVG (the same drawing the board uses). */
import { spriteSvg, type SpriteName } from '#shared/game'

const props = defineProps<{ name: SpriteName }>()
const cache = new Map<SpriteName, string>()
const svg = computed(() => {
  let s = cache.get(props.name)
  if (!s) {
    s = spriteSvg(props.name, 'size-full overflow-visible')
    cache.set(props.name, s)
  }
  return s
})
</script>

<template>
  <!-- The markup is generated from the game's own sprite data, never from anything a player typed. -->
  <!-- eslint-disable vue/no-v-html -->
  <span
    class="inline-block"
    aria-hidden="true"
    v-html="svg"
  />
  <!-- eslint-enable vue/no-v-html -->
</template>
