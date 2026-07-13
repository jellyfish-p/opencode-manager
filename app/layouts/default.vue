<script setup lang="ts">
const { logout } = useAuth()
const route = useRoute()

const links = [
  { label: '仪表盘', to: '/', icon: 'i-lucide-layout-dashboard' },
  { label: '号池', to: '/accounts', icon: 'i-lucide-users' }
]
</script>

<template>
  <div class="min-h-screen bg-default">
    <UHeader>
      <template #left>
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-boxes" class="size-6 text-primary" />
          <span class="font-semibold text-highlighted">OpenCode Manager</span>
        </div>
      </template>

      <template #right>
        <nav class="hidden md:flex items-center gap-1">
          <UButton
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            :variant="route.path === link.to ? 'soft' : 'ghost'"
            :color="route.path === link.to ? 'primary' : 'neutral'"
            :icon="link.icon"
            size="sm"
          >
            {{ link.label }}
          </UButton>
        </nav>
        <UButton
          icon="i-lucide-log-out"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="logout"
        >
          退出
        </UButton>
      </template>
    </UHeader>

    <UMain>
      <UContainer class="py-6">
        <slot />
      </UContainer>
    </UMain>
  </div>
</template>
