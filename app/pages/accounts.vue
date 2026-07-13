<script setup lang="ts">
import type { Account } from '~/composables/useAccounts'

const {
  accounts,
  loading,
  fetchAccounts,
  fetchStats,
  addAccount,
  updateAccount,
  removeAccount,
  removeNonMembers,
  refreshAccount,
  refreshAll
} = useAccounts()

const toast = useToast()

const openAdd = ref(false)
const openEdit = ref(false)
const formName = ref('')
const formCookie = ref('')
const editing = ref<Account | null>(null)
const submitting = ref(false)
const actionId = ref<number | null>(null)
const refreshingAll = ref(false)
const membershipFilter = ref<'all' | 'member' | 'non-member'>('all')

const filteredAccounts = computed(() => {
  if (membershipFilter.value === 'member') {
    return accounts.value.filter(account => account.subscription_status === 'active')
  }
  if (membershipFilter.value === 'non-member') {
    return accounts.value.filter(account => account.subscription_status !== 'active')
  }
  return accounts.value
})

const nonMemberCount = computed(() =>
  accounts.value.filter(account => account.subscription_status !== 'active').length
)

await Promise.all([fetchAccounts(), fetchStats()])

function resetForm() {
  formName.value = ''
  formCookie.value = ''
  editing.value = null
}

function openAddModal() {
  resetForm()
  openAdd.value = true
}

function openEditModal(account: Account) {
  editing.value = account
  formName.value = account.name || ''
  formCookie.value = ''
  openEdit.value = true
}

function closeAddModal() {
  openAdd.value = false
}

function closeEditModal() {
  openEdit.value = false
}

function setMembershipFilter(value: 'all' | 'member' | 'non-member') {
  membershipFilter.value = value
}

async function onAdd() {
  if (!formCookie.value.trim()) {
    toast.add({ title: '请填写 auth cookie', color: 'error' })
    return
  }
  submitting.value = true
  try {
    await addAccount({
      name: formName.value || undefined,
      auth_cookie: formCookie.value
    })
    toast.add({ title: '账号已添加并同步', color: 'success' })
    openAdd.value = false
    resetForm()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || e?.message || '添加失败', color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function onEdit() {
  if (!editing.value) return
  submitting.value = true
  try {
    await updateAccount(editing.value.id, {
      name: formName.value,
      ...(formCookie.value.trim() ? { auth_cookie: formCookie.value } : {})
    })
    toast.add({ title: '账号已更新', color: 'success' })
    openEdit.value = false
    resetForm()
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || e?.message || '更新失败', color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function onRefresh(id: number) {
  actionId.value = id
  try {
    const account = await refreshAccount(id)
    if (account.status === 'error') {
      toast.add({ title: account.last_error || '同步失败', color: 'error' })
    } else {
      toast.add({ title: '同步成功', color: 'success' })
    }
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '同步失败', color: 'error' })
  } finally {
    actionId.value = null
  }
}

async function onToggle(account: Account) {
  actionId.value = account.id
  try {
    const next = account.status === 'disabled' ? 'pending' : 'disabled'
    await updateAccount(account.id, { status: next })
    if (next === 'pending') await refreshAccount(account.id)
    toast.add({ title: next === 'disabled' ? '已禁用' : '已启用并同步', color: 'success' })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '操作失败', color: 'error' })
  } finally {
    actionId.value = null
  }
}

async function onDelete(id: number) {
  if (!confirm('确认删除该账号？')) return
  actionId.value = id
  try {
    await removeAccount(id)
    toast.add({ title: '已删除', color: 'success' })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '删除失败', color: 'error' })
  } finally {
    actionId.value = null
  }
}

async function onRefreshAll() {
  refreshingAll.value = true
  try {
    await refreshAll()
    toast.add({ title: '全部账号已刷新', color: 'success' })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '刷新失败', color: 'error' })
  } finally {
    refreshingAll.value = false
  }
}

async function onDeleteNonMembers() {
  if (!nonMemberCount.value || !confirm(`确认删除 ${nonMemberCount.value} 个非会员账号？`)) return
  try {
    const result = await removeNonMembers()
    toast.add({ title: `已删除 ${result.deleted} 个非会员账号`, color: 'success' })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '批量删除失败', color: 'error' })
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold text-highlighted">号池管理</h1>
        <p class="text-sm text-muted">粘贴 OpenCode 登录 Cookie，自动解析 workspace / 用量</p>
      </div>
      <div class="flex gap-2">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="refreshingAll || loading"
          @click="onRefreshAll"
        >
          全部刷新
        </UButton>
        <UButton icon="i-lucide-plus" color="primary" @click="openAddModal">
          添加账号
        </UButton>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex gap-2">
        <UButton :variant="membershipFilter === 'all' ? 'soft' : 'ghost'" color="neutral" @click="setMembershipFilter('all')">全部 {{ accounts.length }}</UButton>
        <UButton :variant="membershipFilter === 'member' ? 'soft' : 'ghost'" color="neutral" @click="setMembershipFilter('member')">会员 {{ accounts.length - nonMemberCount }}</UButton>
        <UButton :variant="membershipFilter === 'non-member' ? 'soft' : 'ghost'" color="neutral" @click="setMembershipFilter('non-member')">非会员 {{ nonMemberCount }}</UButton>
      </div>
      <UButton v-if="nonMemberCount" icon="i-lucide-trash-2" color="error" variant="outline" @click="onDeleteNonMembers">删除全部非会员</UButton>
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div v-if="!accounts.length" class="py-16 text-center">
        <UIcon name="i-lucide-inbox" class="mx-auto size-10 text-muted" />
        <p class="mt-3 text-muted">号池为空，添加 Cookie 开始管理</p>
        <UButton class="mt-4" icon="i-lucide-plus" @click="openAddModal">添加账号</UButton>
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="border-b border-default bg-elevated/50">
            <tr class="text-left text-muted">
              <th class="px-4 py-3 font-medium">账号</th>
              <th class="px-4 py-3 font-medium">状态</th>
              <th class="px-4 py-3 font-medium">滚动</th>
              <th class="px-4 py-3 font-medium">每周</th>
              <th class="px-4 py-3 font-medium">每月</th>
              <th class="px-4 py-3 font-medium">推荐码</th>
              <th class="px-4 py-3 font-medium">同步</th>
              <th class="px-4 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="account in filteredAccounts"
              :key="account.id"
              class="border-b border-default last:border-0 hover:bg-elevated/40"
            >
              <td class="px-4 py-3">
                <div class="font-medium text-highlighted">
                  {{ account.name || account.email || `#${account.id}` }}
                </div>
                <div class="text-xs text-muted">
                  {{ account.email || '未同步' }}
                </div>
                <div v-if="account.workspace_id" class="text-xs text-muted">
                  {{ account.workspace_id }}
                </div>
                <div class="mt-1 flex flex-wrap gap-1">
                  <UBadge :color="account.subscription_status === 'active' ? 'success' : 'error'" variant="subtle" size="sm">
                    {{ account.subscription_status === 'active' ? '会员' : '非会员' }}
                  </UBadge>
                  <UBadge :color="account.has_upstream_api_key ? 'info' : 'warning'" variant="subtle" size="sm">
                    {{ account.has_upstream_api_key ? '上游 Key 已同步' : '缺少上游 Key' }}
                  </UBadge>
                </div>
                <div v-if="account.last_error" class="mt-1 max-w-xs truncate text-xs text-error">
                  {{ account.last_error }}
                </div>
              </td>
              <td class="px-4 py-3">
                <UBadge :color="statusColor(account.status)" variant="subtle">
                  {{ account.status }}
                </UBadge>
                <div v-if="account.disabled_reason" class="mt-1 text-xs text-muted">{{ account.disabled_reason }}</div>
                <div v-if="account.auto_enable_at" class="mt-1 text-xs text-muted">恢复 {{ formatDate(account.auto_enable_at) }}</div>
              </td>
              <td class="px-4 py-3">
                <div>{{ formatPercent(account.rolling_usage) }}</div>
                <div class="text-xs text-muted">{{ formatQuotaAmount(account.rolling_usage, 5) }}</div>
                <div class="text-xs text-muted">{{ formatDate(account.rolling_reset_at) }}</div>
              </td>
              <td class="px-4 py-3">
                <div>{{ formatPercent(account.weekly_usage) }}</div>
                <div class="text-xs text-muted">{{ formatQuotaAmount(account.weekly_usage, 30) }}</div>
                <div class="text-xs text-muted">{{ formatDate(account.weekly_reset_at) }}</div>
              </td>
              <td class="px-4 py-3">
                <div>{{ formatPercent(account.monthly_usage) }}</div>
                <div class="text-xs text-muted">{{ formatQuotaAmount(account.monthly_usage, 60) }}</div>
                <div class="text-xs text-muted">{{ formatDate(account.monthly_reset_at) }}</div>
              </td>
              <td class="px-4 py-3 font-mono text-xs">
                {{ account.referral_code || '-' }}
              </td>
              <td class="px-4 py-3 text-xs text-muted">
                <div>{{ formatDate(account.last_synced_at) }}</div>
                <div v-if="account.next_quota_refresh_at">下次 {{ formatDate(account.next_quota_refresh_at) }}</div>
              </td>
              <td class="px-4 py-3">
                <div class="flex justify-end gap-1">
                  <UButton
                    icon="i-lucide-refresh-cw"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :loading="actionId === account.id"
                    @click="onRefresh(account.id)"
                  />
                  <UButton
                    icon="i-lucide-pencil"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    @click="openEditModal(account)"
                  />
                  <UButton
                    :icon="account.status === 'disabled' ? 'i-lucide-play' : 'i-lucide-pause'"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :loading="actionId === account.id"
                    @click="onToggle(account)"
                  />
                  <UButton
                    icon="i-lucide-trash-2"
                    size="xs"
                    color="error"
                    variant="ghost"
                    :loading="actionId === account.id"
                    @click="onDelete(account.id)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <UModal v-model:open="openAdd" title="添加账号">
      <template #body>
        <div class="space-y-4">
          <UFormField label="备注名称" name="name">
            <UInput v-model="formName" placeholder="可选，如 账号A" class="w-full" />
          </UFormField>
          <UFormField label="Auth Cookie" name="cookie" required>
            <UTextarea
              v-model="formCookie"
              :rows="6"
              placeholder="粘贴浏览器 Cookie，例如 session=...; other=..."
              class="w-full font-mono text-xs"
            />
          </UFormField>
          <UAlert
            color="info"
            variant="subtle"
            title="获取方式"
            description="登录 opencode.ai 后，在开发者工具 Network 中复制请求 Cookie。系统会请求 /auth 拿 workspace，再解析 /go 页面 SSR 数据。"
          />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="closeAddModal">取消</UButton>
          <UButton color="primary" :loading="submitting" @click="onAdd">添加并同步</UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="openEdit" title="编辑账号">
      <template #body>
        <div class="space-y-4">
          <UFormField label="备注名称" name="name">
            <UInput v-model="formName" placeholder="可选" class="w-full" />
          </UFormField>
          <UFormField label="更新 Auth Cookie" name="cookie">
            <UTextarea
              v-model="formCookie"
              :rows="5"
              placeholder="留空则不修改 Cookie"
              class="w-full font-mono text-xs"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="closeEditModal">取消</UButton>
          <UButton color="primary" :loading="submitting" @click="onEdit">保存</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
