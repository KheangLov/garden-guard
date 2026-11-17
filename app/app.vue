<script setup lang="ts">
const { locale, t } = useI18n()
const { $pwa } = useNuxtApp()
const toast = useToast()
const route = useRoute()
// Inside the gaming gateway the page belongs to the gateway: no manifest or service worker.
const { inGateway } = useGateway()
const progress = useProgressStore()

useHead({
  htmlAttrs: { lang: locale },
  title: () => t('app.title'),
})

onMounted(() => progress.load())

// Once the app has been saved for offline use, say so (first install only).
watch(() => $pwa?.offlineReady, (ready) => {
  if (ready) toast.add({ title: t('pwa.offlineReady'), icon: 'i-lucide-wifi-off', color: 'success' })
})

// A new version is applied on the home or level screens, never in the middle of a level.
watch(() => [$pwa?.needRefresh, route.path] as const, ([needRefresh, path]) => {
  if (needRefresh && !path.startsWith('/play')) void $pwa?.updateServiceWorker(true)
}, { immediate: true })
</script>

<template>
  <UApp :toaster="{ position: 'top-center' }">
    <NuxtPwaManifest v-if="!inGateway" />
    <NuxtRouteAnnouncer />
    <AppBackdrop />
    <NuxtPage />
  </UApp>
</template>
