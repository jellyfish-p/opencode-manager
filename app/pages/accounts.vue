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
  fetchReferralRewards,
  useReferralReward,
  cancelRenewal,
  refreshAll
} = useAccounts()

const toast = useToast()

const openAdd = ref(false)
const openEdit = ref(false)
const openActions = ref(false)
const formName = ref('')
const formCookie = ref('')
const editing = ref<Account | null>(null)
const actionAccount = ref<Account | null>(null)
const submitting = ref(false)
const accountAction = ref<'referral' | 'cancel-renewal' | null>(null)
const referralRewardIds = ref<string[]>([])
const referralRewardsCached = ref<boolean | null>(null)
const referralRewardsLoading = ref(false)
const referralRewardsError = ref(false)
const selectedReferralRewardId = ref<string | null>(null)
const confirmCancellation = ref(false)
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

async function openActionsModal(account: Account) {
  actionAccount.value = account
  confirmCancellation.value = false
  referralRewardIds.value = []
  referralRewardsCached.value = null
  referralRewardsError.value = false
  selectedReferralRewardId.value = null
  openActions.value = true
  referralRewardsLoading.value = true
  try {
    const result = await fetchReferralRewards(account.id)
    if (actionAccount.value?.id !== account.id) return
    referralRewardIds.value = result.rewardIds
    referralRewardsCached.value = result.cached
  } catch (e: any) {
    if (actionAccount.value?.id === account.id) {
      referralRewardsError.value = true
      toast.add({ title: e?.data?.statusMessage || e?.message || '可用推广额度加载失败', color: 'error' })
    }
  } finally {
    if (actionAccount.value?.id === account.id) referralRewardsLoading.value = false
  }
}

function closeAddModal() {
  openAdd.value = false
}

function closeEditModal() {
  openEdit.value = false
}

function closeActionsModal() {
  if (accountAction.value) return
  openActions.value = false
  confirmCancellation.value = false
}

async function onUseReferralReward(rewardId: string) {
  if (!actionAccount.value) return
  accountAction.value = 'referral'
  selectedReferralRewardId.value = rewardId
  try {
    const result = await useReferralReward(actionAccount.value.id, rewardId)
    actionAccount.value = result.account
    referralRewardIds.value = result.rewardIds
    referralRewardsCached.value = true
    toast.add({
      title: result.refreshed ? '推广额度已使用并刷新' : '推广额度已使用，但账户刷新失败',
      description: result.refreshed
        ? `奖励 ${result.rewardId}`
        : `奖励 ${result.rewardId} 已使用，请稍后手动同步账户`,
      color: result.refreshed ? 'success' : 'warning'
    })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || e?.message || '推广额度使用失败', color: 'error' })
  } finally {
    accountAction.value = null
    selectedReferralRewardId.value = null
  }
}

async function onCancelRenewal() {
  if (!actionAccount.value) return
  accountAction.value = 'cancel-renewal'
  try {
    const result = await cancelRenewal(actionAccount.value.id)
    actionAccount.value = result.account
    confirmCancellation.value = false
    toast.add({
      title: result.alreadyCancelled ? '续费已处于关闭状态' : '已关闭自动续费',
      description: result.currentPeriodEnd ? `会员有效期至 ${formatDate(result.currentPeriodEnd)}` : undefined,
      color: 'success'
    })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || e?.message || '关闭续费失败', color: 'error' })
  } finally {
    accountAction.value = null
  }
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

async function copyReferralLink(code: string) {
  const url = `https://opencode.ai/go?ref=${encodeURIComponent(code)}`
  try {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const input = document.createElement('textarea')
      input.value = url
      input.setAttribute('readonly', '')
      input.style.position = 'fixed'
      input.style.opacity = '0'
      document.body.appendChild(input)
      input.select()
      const copied = document.execCommand('copy')
      input.remove()
      if (!copied) throw new Error('Clipboard copy failed')
    }
    toast.add({ title: '推荐链接已复制', description: url, color: 'success' })
  } catch {
    toast.add({ title: '复制失败，请检查浏览器剪贴板权限', color: 'error' })
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
                  <UBadge v-if="account.subscription_cancelled_at" color="neutral" variant="subtle" size="sm">
                    已取消续费
                  </UBadge>
                </div>
                <div v-if="account.subscription_ends_at" class="mt-1 text-xs text-muted">
                  会员有效期至 {{ formatDate(account.subscription_ends_at) }}
                </div>
                <div v-if="account.subscription_cancel_error" class="mt-1 max-w-xs truncate text-xs text-error">
                  取消续费失败：{{ account.subscription_cancel_error }}
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
                <div class="text-xs text-muted">{{ formatQuotaAmount(account.rolling_usage, 12) }}</div>
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
              <td class="px-4 py-3 text-xs">
                <button
                  v-if="account.referral_code"
                  type="button"
                  class="inline-flex items-center gap-1 font-mono text-primary hover:underline"
                  :title="`点击复制 https://opencode.ai/go?ref=${account.referral_code}`"
                  @click="copyReferralLink(account.referral_code)"
                >
                  {{ account.referral_code }}
                  <UIcon name="i-lucide-copy" class="size-3.5" />
                </button>
                <span v-else>-</span>
              </td>
              <td class="px-4 py-3 text-xs text-muted">
                <div>{{ formatDate(account.last_synced_at) }}</div>
                <div v-if="account.next_quota_refresh_at">下次 {{ formatDate(account.next_quota_refresh_at) }}</div>
              </td>
              <td class="px-4 py-3">
                <div class="flex justify-end gap-1">
                  <UButton
                    icon="i-lucide-settings-2"
                    size="xs"
                    color="primary"
                    variant="ghost"
                    title="账户操作"
                    @click="openActionsModal(account)"
                  />
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

    <UModal
      v-model:open="openActions"
      :title="`账户操作 · ${actionAccount?.name || actionAccount?.email || `#${actionAccount?.id || ''}`}`"
      :dismissible="!accountAction"
    >
      <template #body>
        <div v-if="actionAccount" class="space-y-4">
          <div class="rounded-lg border border-default p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="font-medium text-highlighted">可用推广额度</p>
                <p class="mt-1 text-sm text-muted">显示该账户最近一次同步时发现的可用奖励。</p>
              </div>
              <UBadge v-if="referralRewardsCached" color="primary" variant="subtle">
                {{ referralRewardIds.length }} 笔
              </UBadge>
            </div>

            <div v-if="referralRewardsLoading" class="mt-4 flex items-center gap-2 text-sm text-muted">
              <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
              正在读取缓存…
            </div>
            <UAlert
              v-else-if="referralRewardsError"
              class="mt-4"
              color="error"
              variant="subtle"
              title="可用额度加载失败"
              description="请关闭弹窗后重试。"
            />
            <UAlert
              v-else-if="referralRewardsCached === false"
              class="mt-4"
              color="neutral"
              variant="subtle"
              title="尚无可用额度缓存"
              description="请先同步该账号，再重新打开账户操作。"
            />
            <p v-else-if="referralRewardIds.length === 0" class="mt-4 text-sm text-muted">
              暂无可用额度
            </p>
            <div v-else class="mt-4 space-y-2">
              <div
                v-for="rewardId in referralRewardIds"
                :key="rewardId"
                class="flex items-center justify-between gap-3 rounded-md bg-elevated px-3 py-2"
              >
                <span class="min-w-0 truncate font-mono text-sm text-highlighted" :title="rewardId">
                  {{ rewardId }}
                </span>
                <UButton
                  icon="i-lucide-gift"
                  size="sm"
                  color="primary"
                  variant="soft"
                  :loading="selectedReferralRewardId === rewardId"
                  :disabled="Boolean(accountAction)"
                  @click="onUseReferralReward(rewardId)"
                >
                  使用
                </UButton>
              </div>
            </div>

            <p v-if="actionAccount.last_referral_reward_applied_at" class="mt-3 text-xs text-muted">
              上次使用：{{ formatDate(actionAccount.last_referral_reward_applied_at) }}
            </p>
          </div>

          <div class="rounded-lg border border-default p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="font-medium text-highlighted">关闭自动续费</p>
                <p class="mt-1 text-sm text-muted">订阅会在当前计费周期结束时停止，现有会员权益不会立即失效。</p>
                <p v-if="actionAccount.subscription_ends_at" class="mt-2 text-xs text-muted">
                  当前有效期至：{{ formatDate(actionAccount.subscription_ends_at) }}
                </p>
              </div>
              <UBadge v-if="actionAccount.subscription_cancelled_at" color="neutral" variant="subtle">
                已关闭续费
              </UBadge>
              <UButton
                v-else-if="!confirmCancellation"
                icon="i-lucide-calendar-x"
                color="error"
                variant="soft"
                :disabled="Boolean(accountAction) || actionAccount.subscription_status !== 'active'"
                @click="() => { confirmCancellation = true }"
              >
                关闭续费
              </UButton>
            </div>

            <UAlert
              v-if="confirmCancellation && !actionAccount.subscription_cancelled_at"
              class="mt-4"
              color="error"
              variant="subtle"
              title="确认关闭该账户的自动续费？"
              description="该操作会提交到 OpenCode 的 Stripe 订阅门户。"
            >
              <template #actions>
                <div class="flex gap-2">
                  <UButton
                    size="sm"
                    color="neutral"
                    variant="ghost"
                    :disabled="Boolean(accountAction)"
                    @click="() => { confirmCancellation = false }"
                  >
                    返回
                  </UButton>
                  <UButton
                    size="sm"
                    color="error"
                    :loading="accountAction === 'cancel-renewal'"
                    :disabled="Boolean(accountAction)"
                    @click="onCancelRenewal"
                  >
                    确认关闭续费
                  </UButton>
                </div>
              </template>
            </UAlert>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end">
          <UButton color="neutral" variant="ghost" :disabled="Boolean(accountAction)" @click="closeActionsModal">
            关闭
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
