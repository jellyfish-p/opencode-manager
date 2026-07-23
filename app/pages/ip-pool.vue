<script setup lang="ts">
interface IpPoolEntry {
  id: number
  name: string | null
  proxy_url: string
  enabled: boolean
  account_count: number
  last_ip: string | null
  last_check_ok: boolean | null
  last_checked_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

interface IpPoolState {
  entries: IpPoolEntry[]
  block_size: number
  assigned_accounts: number
}

const requestFetch = useRequestFetch()
const toast = useToast()
const state = ref<IpPoolState>({ entries: [], block_size: 5, assigned_accounts: 0 })
const loading = ref(false)
const actionId = ref<number | null>(null)
const savingSettings = ref(false)
const assigning = ref(false)
const openAdd = ref(false)
const openEdit = ref(false)
const formName = ref('')
const formUrls = ref('')
const editing = ref<IpPoolEntry | null>(null)
const blockSize = ref(5)
const deleteTarget = ref<IpPoolEntry | null>(null)
const deleteDialogOpen = ref(false)

async function load() {
  loading.value = true
  try {
    state.value = await requestFetch<IpPoolState>('/api/ip-pool')
    blockSize.value = state.value.block_size
  } finally {
    loading.value = false
  }
}

await load()

function resetForm() {
  formName.value = ''
  formUrls.value = ''
  editing.value = null
}

function openAddModal() {
  resetForm()
  openAdd.value = true
}

function openEditModal(entry: IpPoolEntry) {
  editing.value = entry
  formName.value = entry.name || ''
  formUrls.value = ''
  openEdit.value = true
}

function closeAddModal() {
  openAdd.value = false
}

function closeEditModal() {
  openEdit.value = false
}

async function addProxies() {
  loading.value = true
  try {
    const result = await requestFetch<{ created: number; skipped: number }>('/api/ip-pool', {
      method: 'POST',
      body: { name: formName.value, proxy_urls: formUrls.value }
    })
    openAdd.value = false
    resetForm()
    await load()
    toast.add({
      title: `已添加 ${result.created} 个代理`,
      description: result.skipped ? `跳过 ${result.skipped} 个重复地址` : undefined,
      color: 'success'
    })
  } catch (error: any) {
    toast.add({ title: error?.data?.statusMessage || '添加失败', color: 'error' })
  } finally {
    loading.value = false
  }
}

async function saveEdit() {
  if (!editing.value) return
  actionId.value = editing.value.id
  try {
    await requestFetch(`/api/ip-pool/${editing.value.id}`, {
      method: 'PATCH',
      body: {
        name: formName.value,
        ...(formUrls.value.trim() ? { proxy_url: formUrls.value.trim() } : {})
      }
    })
    openEdit.value = false
    resetForm()
    await load()
    toast.add({ title: '代理已更新', color: 'success' })
  } catch (error: any) {
    toast.add({ title: error?.data?.statusMessage || '更新失败', color: 'error' })
  } finally {
    actionId.value = null
  }
}

async function toggleEntry(entry: IpPoolEntry) {
  actionId.value = entry.id
  try {
    const result = await requestFetch<{ reassigned: number }>(`/api/ip-pool/${entry.id}`, {
      method: 'PATCH',
      body: { enabled: !entry.enabled }
    })
    await load()
    toast.add({
      title: entry.enabled ? '代理已停用' : '代理已启用',
      description: result.reassigned ? `已迁移 ${result.reassigned} 个受影响账号` : undefined,
      color: 'success'
    })
  } catch (error: any) {
    toast.add({ title: error?.data?.statusMessage || '操作失败', color: 'error' })
  } finally {
    actionId.value = null
  }
}

async function testEntry(entry: IpPoolEntry) {
  actionId.value = entry.id
  try {
    const result = await requestFetch<{ ok: boolean; ip?: string; error?: string }>(
      `/api/ip-pool/${entry.id}/test`,
      { method: 'POST' }
    )
    await load()
    toast.add({
      title: result.ok ? `代理可用 · ${result.ip}` : '代理检测失败',
      description: result.error,
      color: result.ok ? 'success' : 'error'
    })
  } catch (error: any) {
    toast.add({ title: error?.data?.statusMessage || '代理检测失败', color: 'error' })
  } finally {
    actionId.value = null
  }
}

function removeEntry(entry: IpPoolEntry) {
  deleteTarget.value = entry
  deleteDialogOpen.value = true
}

async function confirmRemoveEntry() {
  if (!deleteTarget.value) return
  const entry = deleteTarget.value
  actionId.value = entry.id
  try {
    const result = await requestFetch<{ reassigned: number }>(`/api/ip-pool/${entry.id}`, {
      method: 'DELETE'
    })
    await load()
    toast.add({
      title: '代理已删除',
      description: result.reassigned ? `已迁移 ${result.reassigned} 个账号` : undefined,
      color: 'success'
    })
    deleteDialogOpen.value = false
    deleteTarget.value = null
  } catch (error: any) {
    toast.add({ title: error?.data?.statusMessage || '删除失败', color: 'error' })
  } finally {
    actionId.value = null
  }
}

async function saveSettings() {
  savingSettings.value = true
  try {
    await requestFetch('/api/ip-pool/settings', {
      method: 'PATCH',
      body: { block_size: blockSize.value }
    })
    await load()
    toast.add({ title: '分块设置已保存', color: 'success' })
  } catch (error: any) {
    toast.add({ title: error?.data?.statusMessage || '保存失败', color: 'error' })
  } finally {
    savingSettings.value = false
  }
}

async function assignUnbound() {
  assigning.value = true
  try {
    const result = await requestFetch<{ changed: number }>('/api/ip-pool/assign', { method: 'POST' })
    await load()
    toast.add({
      title: result.changed ? `已补齐 ${result.changed} 个账号绑定` : '所有账号绑定均已稳定',
      color: 'success'
    })
  } catch (error: any) {
    toast.add({ title: error?.data?.statusMessage || '绑定失败', color: 'error' })
  } finally {
    assigning.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold text-highlighted">IP 池</h1>
        <p class="text-sm text-muted">为账号固定出口代理，仅在绑定节点被停用或删除时迁移</p>
      </div>
      <div class="flex gap-2">
        <UButton
          icon="i-lucide-blocks"
          color="neutral"
          variant="outline"
          :loading="assigning"
          @click="assignUnbound"
        >
          补齐绑定
        </UButton>
        <UButton icon="i-lucide-plus" @click="openAddModal">添加代理</UButton>
      </div>
    </div>

    <UAlert
      color="info"
      variant="subtle"
      title="稳定绑定策略"
      description="新账号会按块分配给当前绑定数最少的代理；新增代理不会打乱旧绑定。停用或删除代理时，只迁移该代理上的账号。未配置可用代理时保持直连。"
    />

    <div class="grid gap-4 lg:grid-cols-3">
      <UCard>
        <p class="text-sm text-muted">代理节点</p>
        <p class="mt-2 text-3xl font-semibold text-highlighted">{{ state.entries.length }}</p>
      </UCard>
      <UCard>
        <p class="text-sm text-muted">可用节点</p>
        <p class="mt-2 text-3xl font-semibold text-highlighted">{{ state.entries.filter(entry => entry.enabled).length }}</p>
      </UCard>
      <UCard>
        <p class="text-sm text-muted">已绑定账号</p>
        <p class="mt-2 text-3xl font-semibold text-highlighted">{{ state.assigned_accounts }}</p>
      </UCard>
    </div>

    <UCard>
      <template #header><h2 class="font-medium text-highlighted">自动分块</h2></template>
      <div class="flex flex-wrap items-end gap-3">
        <UFormField label="每块账号数" description="只影响之后的新绑定，不会重排已有账号">
          <UInput v-model.number="blockSize" type="number" :min="1" :max="1000" class="w-36" />
        </UFormField>
        <UButton :loading="savingSettings" @click="saveSettings">保存设置</UButton>
      </div>
    </UCard>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div v-if="!state.entries.length" class="py-16 text-center">
        <UIcon name="i-lucide-network" class="mx-auto size-10 text-muted" />
        <p class="mt-3 text-muted">IP 池为空，账号当前使用服务器直连出口</p>
        <UButton class="mt-4" icon="i-lucide-plus" @click="openAddModal">添加代理</UButton>
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="border-b border-default bg-elevated/50">
            <tr class="text-left text-muted">
              <th class="px-4 py-3 font-medium">节点</th>
              <th class="px-4 py-3 font-medium">代理地址</th>
              <th class="px-4 py-3 font-medium">出口 IP / 检测</th>
              <th class="px-4 py-3 font-medium">绑定账号</th>
              <th class="px-4 py-3 font-medium">状态</th>
              <th class="px-4 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in state.entries" :key="entry.id" class="border-b border-default last:border-0">
              <td class="px-4 py-3">
                <p class="font-medium text-highlighted">{{ entry.name || `代理 #${entry.id}` }}</p>
                <p class="text-xs text-muted">#{{ entry.id }}</p>
              </td>
              <td class="max-w-xs px-4 py-3 font-mono text-xs">
                <span class="break-all">{{ entry.proxy_url }}</span>
              </td>
              <td class="px-4 py-3">
                <p class="font-mono text-xs">{{ entry.last_ip || '尚未检测' }}</p>
                <p v-if="entry.last_checked_at" class="mt-1 text-xs text-muted">{{ formatDate(entry.last_checked_at) }}</p>
                <p v-if="entry.last_error" class="mt-1 max-w-xs truncate text-xs text-error" :title="entry.last_error">
                  {{ entry.last_error }}
                </p>
              </td>
              <td class="px-4 py-3">{{ entry.account_count }}</td>
              <td class="px-4 py-3">
                <UBadge :color="entry.enabled ? 'success' : 'neutral'" variant="subtle">
                  {{ entry.enabled ? '启用' : '停用' }}
                </UBadge>
                <UBadge
                  v-if="entry.last_check_ok !== null"
                  class="ml-1"
                  :color="entry.last_check_ok ? 'info' : 'error'"
                  variant="subtle"
                >
                  {{ entry.last_check_ok ? '可连接' : '检测失败' }}
                </UBadge>
              </td>
              <td class="px-4 py-3">
                <div class="flex justify-end gap-1">
                  <UButton
                    icon="i-lucide-stethoscope"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    title="检测出口 IP"
                    :loading="actionId === entry.id"
                    @click="testEntry(entry)"
                  />
                  <UButton
                    :icon="entry.enabled ? 'i-lucide-pause' : 'i-lucide-play'"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :title="entry.enabled ? '停用' : '启用'"
                    :loading="actionId === entry.id"
                    @click="toggleEntry(entry)"
                  />
                  <UButton icon="i-lucide-pencil" size="xs" color="neutral" variant="ghost" @click="openEditModal(entry)" />
                  <UButton
                    icon="i-lucide-trash-2"
                    size="xs"
                    color="error"
                    variant="ghost"
                    :loading="actionId === entry.id"
                    @click="removeEntry(entry)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <UModal v-model:open="openAdd" title="添加出口代理">
      <template #body>
        <div class="space-y-4">
          <UFormField label="名称"><UInput v-model="formName" placeholder="可选；批量添加时自动编号" class="w-full" /></UFormField>
          <UFormField label="代理地址" required>
            <UTextarea
              v-model="formUrls"
              :rows="7"
              class="w-full font-mono text-xs"
              placeholder="每行一个，例如：&#10;http://user:pass@1.2.3.4:8080&#10;socks5://user:pass@1.2.3.4:1080&#10;1.2.3.4:8080:user:pass"
            />
          </UFormField>
          <UAlert color="neutral" variant="subtle" title="支持 HTTP / HTTPS / SOCKS5 代理" description="SOCKS5 可使用 socks5://、socks5h:// 或 sk5://；账号密码只保存在服务端，列表中密码会被隐藏。" />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="closeAddModal">取消</UButton>
          <UButton :loading="loading" @click="addProxies">添加并自动绑定</UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="openEdit" title="编辑出口代理">
      <template #body>
        <div class="space-y-4">
          <UFormField label="名称"><UInput v-model="formName" class="w-full" /></UFormField>
          <UFormField label="新代理地址">
            <UInput v-model="formUrls" type="password" placeholder="留空保留当前地址和凭据" class="w-full font-mono" />
          </UFormField>
          <p class="text-xs text-muted">当前：{{ editing?.proxy_url }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="closeEditModal">取消</UButton>
          <UButton :loading="actionId === editing?.id" @click="saveEdit">保存</UButton>
        </div>
      </template>
    </UModal>

    <AppConfirmDialog
      v-model:open="deleteDialogOpen"
      title="删除出口代理？"
      :description="`将删除“${deleteTarget?.name || `代理 #${deleteTarget?.id || ''}`}”。绑定账号会自动迁移到其他可用出口。`"
      :loading="actionId === deleteTarget?.id"
      @confirm="confirmRemoveEntry"
    />
  </div>
</template>
