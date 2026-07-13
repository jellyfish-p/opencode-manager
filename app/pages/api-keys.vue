<script setup lang="ts">
interface ApiKeyItem {
  id: string
  name: string
  prefix: string
  source: 'config' | 'web'
  created_at: string | null
}

const requestFetch = useRequestFetch()
const toast = useToast()
const keys = ref<ApiKeyItem[]>([])
const open = ref(false)
const name = ref('')
const customKey = ref('')
const createdKey = ref('')
const submitting = ref(false)
const baseUrl = `${useRequestURL().origin}/v1`

async function load() {
  keys.value = await requestFetch<ApiKeyItem[]>('/api/api-keys')
}

function openModal() {
  open.value = true
}

function closeModal() {
  open.value = false
}

await load()

async function createKey() {
  submitting.value = true
  try {
    const result = await requestFetch<ApiKeyItem & { key: string }>('/api/api-keys', {
      method: 'POST',
      body: { name: name.value, key: customKey.value || undefined }
    })
    createdKey.value = result.key
    open.value = false
    name.value = ''
    customKey.value = ''
    await load()
    toast.add({ title: 'API 密钥已创建', color: 'success' })
  } catch (error: any) {
    toast.add({ title: error?.data?.statusMessage || '创建失败', color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function removeKey(key: ApiKeyItem) {
  if (key.source === 'config' || !confirm(`确认删除 ${key.name}？`)) return
  await requestFetch(`/api/api-keys/${key.id}`, { method: 'DELETE' })
  await load()
  toast.add({ title: 'API 密钥已删除', color: 'success' })
}

async function copy(value: string) {
  await navigator.clipboard.writeText(value)
  toast.add({ title: '已复制', color: 'success' })
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold text-highlighted">API 密钥</h1>
        <p class="text-sm text-muted">管理 OpenAI 兼容接口的访问密钥</p>
      </div>
      <UButton icon="i-lucide-plus" @click="openModal">添加密钥</UButton>
    </div>

    <UAlert
      v-if="createdKey"
      color="success"
      variant="subtle"
      title="请立即保存新密钥，它只显示这一次"
    >
      <template #description>
        <div class="mt-2 flex items-center gap-2">
          <code class="min-w-0 flex-1 break-all rounded bg-default p-2">{{ createdKey }}</code>
          <UButton icon="i-lucide-copy" color="neutral" variant="outline" @click="copy(createdKey)" />
        </div>
      </template>
    </UAlert>

    <UCard>
      <template #header><h2 class="font-medium">接口信息</h2></template>
      <div class="space-y-2 text-sm">
        <div><span class="text-muted">Base URL：</span><code>{{ baseUrl }}</code></div>
        <div><span class="text-muted">Chat：</span><code>POST {{ baseUrl }}/chat/completions</code></div>
        <div><span class="text-muted">Models：</span><code>GET {{ baseUrl }}/models</code></div>
      </div>
    </UCard>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <table class="w-full text-sm">
        <thead class="border-b border-default bg-elevated/50">
          <tr class="text-left text-muted"><th class="p-4">名称</th><th class="p-4">密钥</th><th class="p-4">来源</th><th class="p-4">创建时间</th><th class="p-4"></th></tr>
        </thead>
        <tbody>
          <tr v-for="key in keys" :key="key.id" class="border-b border-default last:border-0">
            <td class="p-4 font-medium">{{ key.name }}</td>
            <td class="p-4 font-mono">{{ key.prefix }}</td>
            <td class="p-4"><UBadge variant="subtle">{{ key.source === 'config' ? 'config.yaml' : '网页' }}</UBadge></td>
            <td class="p-4 text-muted">{{ formatDate(key.created_at) }}</td>
            <td class="p-4 text-right"><UButton v-if="key.source === 'web'" icon="i-lucide-trash-2" color="error" variant="ghost" @click="removeKey(key)" /></td>
          </tr>
        </tbody>
      </table>
    </UCard>

    <UModal v-model:open="open" title="添加 API 密钥">
      <template #body>
        <div class="space-y-4">
          <UFormField label="名称"><UInput v-model="name" placeholder="例如 Claude Code" class="w-full" /></UFormField>
          <UFormField label="自定义密钥（留空自动生成）"><UInput v-model="customKey" type="password" placeholder="sk-..." class="w-full" /></UFormField>
        </div>
      </template>
      <template #footer><div class="flex justify-end gap-2"><UButton color="neutral" variant="ghost" @click="closeModal">取消</UButton><UButton :loading="submitting" @click="createKey">创建</UButton></div></template>
    </UModal>
  </div>
</template>
