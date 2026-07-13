<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const { authenticated, login } = useAuth()
const toast = useToast()

const key = ref('')
const loading = ref(false)
const error = ref('')

if (import.meta.client) {
  const { check } = useAuth()
  await check()
  if (authenticated.value) {
    await navigateTo('/')
  }
}

async function onSubmit() {
  error.value = ''
  loading.value = true
  try {
    await login(key.value)
    toast.add({ title: '登录成功', color: 'success' })
    await navigateTo('/')
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UCard class="w-full max-w-md">
    <template #header>
      <div class="flex items-center gap-3">
        <UIcon name="i-lucide-boxes" class="size-7 text-primary" />
        <div>
          <h1 class="text-lg font-semibold text-highlighted">OpenCode Manager</h1>
          <p class="text-sm text-muted">使用 admin_key 登录</p>
        </div>
      </div>
    </template>

    <form class="space-y-4" @submit.prevent="onSubmit">
      <UFormField label="Admin Key" name="key" required>
        <UInput
          v-model="key"
          type="password"
          placeholder="config.yaml 中的 admin_key"
          icon="i-lucide-key-round"
          size="lg"
          autofocus
          class="w-full"
        />
      </UFormField>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        :title="error"
        icon="i-lucide-circle-alert"
      />

      <UButton type="submit" block size="lg" :loading="loading" icon="i-lucide-log-in">
        登录
      </UButton>
    </form>
  </UCard>
</template>
