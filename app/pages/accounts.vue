<script setup lang="ts">
import type {
  Account,
  AccountBatchAction,
  AccountBatchProgress
} from '~/composables/useAccounts'

type DeleteIntent =
  | { kind: 'account'; id: number; label: string }
  | { kind: 'non-members'; count: number }
  | { kind: 'selected'; ids: number[] }

const {
  accounts,
  loading,
  fetchAccounts,
  fetchStats,
  addAccounts,
  updateAccount,
  fetchAccountAuthCookie,
  removeAccount,
  removeNonMembers,
  refreshAccount,
  fetchReferralRewards,
  useReferralReward,
  cancelRenewal,
  checkRiskControl,
  runAccountBatch
} = useAccounts()

const toast = useToast()

const openAdd = ref(false)
const openEdit = ref(false)
const openActions = ref(false)
const formName = ref('')
const formCookie = ref('')
const editing = ref<Account | null>(null)
const editCookieLoading = ref(false)
const initialEditCookie = ref('')
const editCookieRequestGeneration = ref(0)
const actionAccount = ref<Account | null>(null)
const submitting = ref(false)
const accountAction = ref<'referral' | 'cancel-renewal' | null>(null)
const referralRewardIds = ref<string[]>([])
const usedReferralRewardIds = ref<string[]>([])
const referralRewardsCached = ref<boolean | null>(null)
const referralRewardsLoading = ref(false)
const referralRewardsError = ref(false)
const selectedReferralRewardId = ref<string | null>(null)
const usedReferralRewardsOpen = ref(false)
const confirmCancellation = ref(false)
const actionId = ref<number | null>(null)
const refreshingAll = ref(false)
const checkingAllRiskControls = ref(false)
const membershipFilter = ref<'all' | 'member' | 'non-member'>('all')
const riskControlFilter = ref<'all' | 'risk-controlled' | 'not-risk-controlled'>('all')
const selectedAccountIds = ref<number[]>([])
const bulkAction = ref<AccountBatchAction | null>(null)
const batchProgress = ref<(AccountBatchProgress & { label: string }) | null>(null)
const deleteIntent = ref<DeleteIntent | null>(null)
const deleteDialogOpen = ref(false)
const deleteConfirmLoading = ref(false)

const filteredAccounts = computed(() => {
  return accounts.value.filter((account) => {
    const matchesMembership =
      membershipFilter.value === 'all' ||
      (membershipFilter.value === 'member' && account.subscription_status === 'active') ||
      (membershipFilter.value === 'non-member' && account.subscription_status !== 'active')
    const isRiskControlled = account.disabled_reason === 'risk_control'
    const matchesRiskControl =
      riskControlFilter.value === 'all' ||
      (riskControlFilter.value === 'risk-controlled' && isRiskControlled) ||
      (riskControlFilter.value === 'not-risk-controlled' && !isRiskControlled)
    return matchesMembership && matchesRiskControl
  })
})

const nonMemberCount = computed(() =>
  accounts.value.filter(account => account.subscription_status !== 'active').length
)
const riskControlledCount = computed(() =>
  accounts.value.filter(account => account.disabled_reason === 'risk_control').length
)
const selectedAccountIdSet = computed(() => new Set(selectedAccountIds.value))
const allFilteredSelected = computed(() =>
  filteredAccounts.value.length > 0 &&
  filteredAccounts.value.every(account => selectedAccountIdSet.value.has(account.id))
)
const someFilteredSelected = computed(() =>
  filteredAccounts.value.some(account => selectedAccountIdSet.value.has(account.id))
)
const selectAllValue = computed<boolean | 'indeterminate'>(() =>
  allFilteredSelected.value ? true : someFilteredSelected.value ? 'indeterminate' : false
)
const deleteDialogTitle = computed(() => {
  if (deleteIntent.value?.kind === 'non-members') return '删除全部非会员账号？'
  if (deleteIntent.value?.kind === 'selected') return '删除选中的账号？'
  return '删除账号？'
})
const deleteDialogDescription = computed(() => {
  const intent = deleteIntent.value
  if (!intent) return ''
  if (intent.kind === 'account') {
    return `将永久删除账号“${intent.label}”及其本地同步数据。此操作无法撤销。`
  }
  if (intent.kind === 'non-members') {
    return `将永久删除 ${intent.count} 个非会员账号及其本地同步数据。此操作无法撤销。`
  }
  return `将永久删除选中的 ${intent.ids.length} 个账号及其本地同步数据。此操作无法撤销。`
})

watch(
  () => accounts.value.map(account => account.id),
  (ids) => {
    const existingIds = new Set(ids)
    selectedAccountIds.value = selectedAccountIds.value.filter(id => existingIds.has(id))
  }
)

await Promise.all([fetchAccounts(), fetchStats()])

function resetForm() {
  editCookieRequestGeneration.value++
  formName.value = ''
  formCookie.value = ''
  initialEditCookie.value = ''
  editCookieLoading.value = false
  editing.value = null
}

function openAddModal() {
  resetForm()
  openAdd.value = true
}

async function openEditModal(account: Account) {
  const requestGeneration = ++editCookieRequestGeneration.value
  editing.value = account
  formName.value = account.name || ''
  formCookie.value = ''
  initialEditCookie.value = ''
  openEdit.value = true
  editCookieLoading.value = true
  try {
    const result = await fetchAccountAuthCookie(account.id)
    if (
      editCookieRequestGeneration.value === requestGeneration &&
      openEdit.value &&
      editing.value?.id === account.id
    ) {
      formCookie.value = result.auth_cookie
      initialEditCookie.value = result.auth_cookie
    }
  } catch (e: any) {
    if (
      editCookieRequestGeneration.value === requestGeneration &&
      openEdit.value &&
      editing.value?.id === account.id
    ) {
      toast.add({ title: e?.data?.statusMessage || e?.message || 'Cookie value 加载失败', color: 'error' })
    }
  } finally {
    if (
      editCookieRequestGeneration.value === requestGeneration &&
      openEdit.value &&
      editing.value?.id === account.id
    ) {
      editCookieLoading.value = false
    }
  }
}

async function openActionsModal(account: Account) {
  actionAccount.value = account
  confirmCancellation.value = false
  referralRewardIds.value = []
  usedReferralRewardIds.value = []
  referralRewardsCached.value = null
  referralRewardsError.value = false
  selectedReferralRewardId.value = null
  usedReferralRewardsOpen.value = false
  openActions.value = true
  referralRewardsLoading.value = true
  try {
    const result = await fetchReferralRewards(account.id)
    if (actionAccount.value?.id !== account.id) return
    referralRewardIds.value = result.rewardIds
    usedReferralRewardIds.value = result.usedRewardIds
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
  resetForm()
}

function onEditModalOpenChange(value: boolean) {
  if (value) {
    openEdit.value = true
  } else {
    closeEditModal()
  }
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
    usedReferralRewardIds.value = result.usedRewardIds
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
  selectedAccountIds.value = []
}

function setRiskControlFilter(value: 'all' | 'risk-controlled' | 'not-risk-controlled') {
  riskControlFilter.value = value
  selectedAccountIds.value = []
}

function setAccountSelected(id: number, value: boolean | 'indeterminate') {
  if (value === true) {
    if (!selectedAccountIdSet.value.has(id)) {
      selectedAccountIds.value = [...selectedAccountIds.value, id]
    }
  } else {
    selectedAccountIds.value = selectedAccountIds.value.filter(selectedId => selectedId !== id)
  }
}

function setAllFilteredSelected(value: boolean | 'indeterminate') {
  const filteredIds = new Set(filteredAccounts.value.map(account => account.id))
  if (value === true) {
    selectedAccountIds.value = [
      ...new Set([...selectedAccountIds.value, ...filteredIds])
    ]
  } else {
    selectedAccountIds.value = selectedAccountIds.value.filter(id => !filteredIds.has(id))
  }
}

async function onAdd() {
  if (!formCookie.value.trim()) {
    toast.add({ title: '请填写至少一个 auth Cookie value', color: 'error' })
    return
  }
  submitting.value = true
  try {
    const result = await addAccounts({
      name: formName.value || undefined,
      auth_cookie_values: formCookie.value
    })
    toast.add({
      title: result.failed
        ? `已添加 ${result.created} 个账号，${result.failed} 个同步失败`
        : `已添加并同步 ${result.synchronized} 个账号`,
      description: result.failed ? '失败账号已保留，可稍后单独刷新' : undefined,
      color: result.failed ? 'warning' : 'success'
    })
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
  const nextCookie = formCookie.value.trim()
  submitting.value = true
  try {
    await updateAccount(editing.value.id, {
      name: formName.value,
      ...(nextCookie && nextCookie !== initialEditCookie.value ? { auth_cookie: nextCookie } : {})
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

function onDelete(account: Account) {
  deleteIntent.value = {
    kind: 'account',
    id: account.id,
    label: account.name || account.email || `#${account.id}`
  }
  deleteDialogOpen.value = true
}

async function onRefreshAll() {
  refreshingAll.value = true
  try {
    const ids = accounts.value
      .filter(account => account.disabled_reason !== 'manual')
      .map(account => account.id)
    const result = await runAccountBatch(
      ids,
      'refresh',
      progress => {
        batchProgress.value = { label: '全部刷新', ...progress }
      }
    )
    toast.add({
      title: `已刷新 ${result.succeeded} 个账号`,
      description: result.failed ? `${result.failed} 个账号刷新失败` : undefined,
      color: result.failed ? 'warning' : 'success'
    })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '刷新失败', color: 'error' })
  } finally {
    refreshingAll.value = false
    batchProgress.value = null
  }
}

async function onCheckRiskControl(account: Account) {
  actionId.value = account.id
  try {
    const result = await checkRiskControl(account.id)
    toast.add({
      title: result.blocked
        ? '检测到账号风控，已自动禁用'
        : result.upstreamStatus >= 200 && result.upstreamStatus < 300
          ? '风控检测通过'
          : `未检测到风控，上游返回 ${result.upstreamStatus}`,
      description: result.message || undefined,
      color: result.blocked ? 'error' : result.upstreamStatus < 300 ? 'success' : 'warning'
    })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || e?.message || '风控检测失败', color: 'error' })
  } finally {
    actionId.value = null
  }
}

async function onCheckAllRiskControls() {
  checkingAllRiskControls.value = true
  try {
    const ids = accounts.value
      .filter(account =>
        account.has_upstream_api_key &&
        account.disabled_reason !== 'manual' &&
        (account.status === 'active' || account.disabled_reason === 'risk_control')
      )
      .map(account => account.id)
    const result = await runAccountBatch(
      ids,
      'risk-control-check',
      progress => {
        batchProgress.value = { label: '全部风控检测', ...progress }
      }
    )
    toast.add({
      title: result.blocked
        ? `检测完成，自动禁用 ${result.blocked} 个风控账号`
        : '风控检测完成，未发现风控账号',
      description: [
        `共检测 ${result.succeeded} 个可用或待复检账号`,
        result.failed ? `${result.failed} 个检测失败` : ''
      ].filter(Boolean).join('；'),
      color: result.blocked || result.failed ? 'warning' : 'success'
    })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || e?.message || '批量风控检测失败', color: 'error' })
  } finally {
    checkingAllRiskControls.value = false
    batchProgress.value = null
  }
}

function onDeleteNonMembers() {
  if (!nonMemberCount.value) return
  deleteIntent.value = { kind: 'non-members', count: nonMemberCount.value }
  deleteDialogOpen.value = true
}

async function onBulkAction(action: AccountBatchAction) {
  const ids = [...selectedAccountIds.value]
  if (!ids.length) return
  if (action === 'delete') {
    deleteIntent.value = { kind: 'selected', ids }
    deleteDialogOpen.value = true
    return
  }
  await executeBulkAction(action, ids)
}

async function executeBulkAction(action: AccountBatchAction, ids: number[]) {
  bulkAction.value = action
  try {
    const labels: Record<AccountBatchAction, string> = {
      refresh: '刷新',
      'risk-control-check': '风控检测',
      enable: '启用',
      disable: '禁用',
      delete: '删除'
    }
    const result = await runAccountBatch(
      ids,
      action,
      progress => {
        batchProgress.value = { label: `批量${labels[action]}`, ...progress }
      }
    )
    const description = [
      result.skipped
        ? action === 'risk-control-check'
          ? `跳过 ${result.skipped} 个缺少上游 Key 的账号`
          : action === 'enable'
            ? `跳过 ${result.skipped} 个未处于禁用状态的账号`
            : action === 'disable'
              ? `跳过 ${result.skipped} 个已禁用账号`
              : ''
        : '',
      action === 'risk-control-check' && result.blocked ? `发现 ${result.blocked} 个风控账号` : '',
      result.failed ? `${result.failed} 个账号操作失败` : ''
    ].filter(Boolean).join('；')
    toast.add({
      title: `已对 ${result.succeeded} 个账号完成${labels[action]}`,
      description: description || undefined,
      color: result.blocked || result.skipped || result.failed ? 'warning' : 'success'
    })
    selectedAccountIds.value = []
    return true
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || e?.message || '批量操作失败', color: 'error' })
    return false
  } finally {
    bulkAction.value = null
    batchProgress.value = null
  }
}

async function confirmDelete() {
  const intent = deleteIntent.value
  if (!intent) return

  deleteConfirmLoading.value = true
  try {
    if (intent.kind === 'account') {
      actionId.value = intent.id
      await removeAccount(intent.id)
      toast.add({ title: '账号已删除', color: 'success' })
    } else if (intent.kind === 'non-members') {
      const result = await removeNonMembers()
      toast.add({ title: `已删除 ${result.deleted} 个非会员账号`, color: 'success' })
    } else {
      const succeeded = await executeBulkAction('delete', intent.ids)
      if (!succeeded) return
    }
    deleteDialogOpen.value = false
    deleteIntent.value = null
  } catch (e: any) {
    toast.add({
      title: e?.data?.statusMessage || e?.message || '删除失败',
      color: 'error'
    })
  } finally {
    actionId.value = null
    deleteConfirmLoading.value = false
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
        <p class="text-sm text-muted">粘贴 auth Cookie 的纯 value，每行一个，自动解析 workspace / 用量</p>
      </div>
      <div class="flex gap-2">
        <UButton
          icon="i-lucide-shield-check"
          color="neutral"
          variant="outline"
          :loading="checkingAllRiskControls"
          :disabled="Boolean(batchProgress)"
          @click="onCheckAllRiskControls"
        >
          风控检测
        </UButton>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="refreshingAll || loading"
          :disabled="Boolean(batchProgress)"
          @click="onRefreshAll"
        >
          全部刷新
        </UButton>
        <UButton icon="i-lucide-plus" color="primary" @click="openAddModal">
          添加账号
        </UButton>
      </div>
    </div>

    <div
      v-if="batchProgress"
      class="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
      aria-live="polite"
    >
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-primary" />
          <span class="font-medium text-highlighted">{{ batchProgress.label }}</span>
        </div>
        <span class="text-muted">
          {{ batchProgress.completed }} / {{ batchProgress.total }}
          <template v-if="batchProgress.failed"> · 失败 {{ batchProgress.failed }}</template>
          <template v-if="batchProgress.skipped"> · 跳过 {{ batchProgress.skipped }}</template>
        </span>
      </div>
      <UProgress
        :model-value="batchProgress.completed"
        :max="Math.max(batchProgress.total, 1)"
        color="primary"
        size="sm"
      />
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div class="flex items-center gap-1">
          <span class="mr-1 text-xs text-muted">会员</span>
          <UButton :variant="membershipFilter === 'all' ? 'soft' : 'ghost'" color="neutral" size="sm" @click="setMembershipFilter('all')">全部 {{ accounts.length }}</UButton>
          <UButton :variant="membershipFilter === 'member' ? 'soft' : 'ghost'" color="neutral" size="sm" @click="setMembershipFilter('member')">会员 {{ accounts.length - nonMemberCount }}</UButton>
          <UButton :variant="membershipFilter === 'non-member' ? 'soft' : 'ghost'" color="neutral" size="sm" @click="setMembershipFilter('non-member')">非会员 {{ nonMemberCount }}</UButton>
        </div>
        <div class="flex items-center gap-1">
          <span class="mr-1 text-xs text-muted">风控</span>
          <UButton :variant="riskControlFilter === 'all' ? 'soft' : 'ghost'" color="neutral" size="sm" @click="setRiskControlFilter('all')">全部 {{ accounts.length }}</UButton>
          <UButton :variant="riskControlFilter === 'risk-controlled' ? 'soft' : 'ghost'" color="error" size="sm" @click="setRiskControlFilter('risk-controlled')">风控中 {{ riskControlledCount }}</UButton>
          <UButton :variant="riskControlFilter === 'not-risk-controlled' ? 'soft' : 'ghost'" color="neutral" size="sm" @click="setRiskControlFilter('not-risk-controlled')">未风控 {{ accounts.length - riskControlledCount }}</UButton>
        </div>
      </div>
      <UButton v-if="nonMemberCount" icon="i-lucide-trash-2" color="error" variant="outline" @click="onDeleteNonMembers">删除全部非会员</UButton>
    </div>

    <div
      v-if="selectedAccountIds.length"
      class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
    >
      <div class="flex items-center gap-2 text-sm">
        <UIcon name="i-lucide-list-checks" class="size-4 text-primary" />
        <span class="font-medium text-highlighted">已选择 {{ selectedAccountIds.length }} 个账号</span>
        <UButton
          size="xs"
          color="neutral"
          variant="link"
          :disabled="Boolean(bulkAction) || Boolean(batchProgress)"
          @click="selectedAccountIds = []"
        >
          取消选择
        </UButton>
      </div>
      <div class="flex flex-wrap gap-1">
        <UButton
          icon="i-lucide-shield-check"
          size="sm"
          color="neutral"
          variant="ghost"
          :loading="bulkAction === 'risk-control-check'"
          :disabled="Boolean(bulkAction) || Boolean(batchProgress)"
          @click="onBulkAction('risk-control-check')"
        >
          风控检测
        </UButton>
        <UButton
          icon="i-lucide-refresh-cw"
          size="sm"
          color="neutral"
          variant="ghost"
          :loading="bulkAction === 'refresh'"
          :disabled="Boolean(bulkAction) || Boolean(batchProgress)"
          @click="onBulkAction('refresh')"
        >
          刷新
        </UButton>
        <UButton
          icon="i-lucide-play"
          size="sm"
          color="neutral"
          variant="ghost"
          :loading="bulkAction === 'enable'"
          :disabled="Boolean(bulkAction) || Boolean(batchProgress)"
          @click="onBulkAction('enable')"
        >
          启用
        </UButton>
        <UButton
          icon="i-lucide-pause"
          size="sm"
          color="neutral"
          variant="ghost"
          :loading="bulkAction === 'disable'"
          :disabled="Boolean(bulkAction) || Boolean(batchProgress)"
          @click="onBulkAction('disable')"
        >
          禁用
        </UButton>
        <UButton
          icon="i-lucide-trash-2"
          size="sm"
          color="error"
          variant="ghost"
          :loading="bulkAction === 'delete'"
          :disabled="Boolean(bulkAction) || Boolean(batchProgress)"
          @click="onBulkAction('delete')"
        >
          删除
        </UButton>
      </div>
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
              <th class="w-12 px-4 py-3 font-medium">
                <UCheckbox
                  :model-value="selectAllValue"
                  :disabled="!filteredAccounts.length"
                  aria-label="全选当前筛选结果"
                  title="全选当前筛选结果"
                  @update:model-value="setAllFilteredSelected"
                />
              </th>
              <th class="px-4 py-3 font-medium">账号</th>
              <th class="px-4 py-3 font-medium">状态</th>
              <th class="px-4 py-3 font-medium">出口</th>
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
              :class="{ 'bg-primary/5': selectedAccountIdSet.has(account.id) }"
            >
              <td class="w-12 px-4 py-3">
                <UCheckbox
                  :model-value="selectedAccountIdSet.has(account.id)"
                  :aria-label="`选择账号 ${account.name || account.email || account.id}`"
                  @update:model-value="value => setAccountSelected(account.id, value)"
                />
              </td>
              <td class="px-4 py-3">
                <div class="font-medium text-highlighted">
                  {{ account.name || account.email || `#${account.id}` }}
                </div>
                <div class="text-xs text-muted">
                  {{ account.email || '邮箱未知' }}
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
                <div v-if="account.risk_control_detected_at" class="mt-1 text-xs text-error">
                  {{ account.disabled_reason === 'risk_control' ? '风控命中' : '最近风控' }}
                  {{ formatDate(account.risk_control_detected_at) }}
                </div>
                <div v-if="account.risk_control_checked_at" class="mt-1 text-xs text-muted">
                  检测 {{ formatDate(account.risk_control_checked_at) }}
                </div>
                <div v-if="account.auto_enable_at" class="mt-1 text-xs text-muted">恢复 {{ formatDate(account.auto_enable_at) }}</div>
              </td>
              <td class="px-4 py-3">
                <UBadge :color="account.ip_pool_id ? 'info' : 'neutral'" variant="subtle">
                  {{ account.ip_pool_id ? `IP #${account.ip_pool_id}` : '直连' }}
                </UBadge>
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
                    icon="i-lucide-shield-check"
                    size="xs"
                    :color="account.disabled_reason === 'risk_control' ? 'error' : 'neutral'"
                    variant="ghost"
                    title="风控检测"
                    :loading="actionId === account.id"
                    @click="onCheckRiskControl(account)"
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
                    @click="onDelete(account)"
                  />
                </div>
              </td>
            </tr>
            <tr v-if="!filteredAccounts.length">
              <td colspan="10" class="px-4 py-12 text-center text-muted">
                没有符合当前筛选条件的账号
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
            <UInput v-model="formName" placeholder="可选；批量添加时自动追加序号" class="w-full" />
          </UFormField>
          <UFormField label="Auth Cookie Values" name="cookie" required>
            <UTextarea
              v-model="formCookie"
              :rows="8"
              placeholder="每行一个纯 value，不要包含 auth= 或其他 Cookie"
              class="w-full font-mono text-xs"
            />
          </UFormField>
          <UAlert
            color="info"
            variant="subtle"
            title="仅接收 auth 的 value"
            description="从 auth={value} 中只复制 value 部分；可按回车分隔批量添加。完整 Cookie、auth= 前缀和其他键值不会被兼容提取。"
          />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="closeAddModal">取消</UButton>
          <UButton color="primary" :loading="submitting" @click="onAdd">批量添加并同步</UButton>
        </div>
      </template>
    </UModal>

    <UModal :open="openEdit" title="编辑账号" @update:open="onEditModalOpenChange">
      <template #body>
        <div class="space-y-4">
          <UFormField label="备注名称" name="name">
            <UInput v-model="formName" placeholder="可选" class="w-full" />
          </UFormField>
          <UFormField label="Auth Cookie Value" name="cookie">
            <UTextarea
              v-model="formCookie"
              :rows="5"
              :disabled="editCookieLoading"
              :placeholder="editCookieLoading ? '正在加载当前 value…' : '仅填写 auth={value} 中的 value'"
              class="w-full font-mono text-xs"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="closeEditModal">取消</UButton>
          <UButton color="primary" :loading="submitting" :disabled="editCookieLoading" @click="onEdit">保存</UButton>
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

            <div v-if="referralRewardsCached" class="mt-4 border-t border-default pt-3">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 rounded-md px-1 py-2 text-left hover:bg-elevated/60"
                :aria-expanded="usedReferralRewardsOpen"
                @click="usedReferralRewardsOpen = !usedReferralRewardsOpen"
              >
                <span class="flex items-center gap-2">
                  <span class="text-sm font-medium text-highlighted">已使用推广额度</span>
                  <UBadge color="neutral" variant="subtle" size="sm">
                    {{ usedReferralRewardIds.length }} 笔
                  </UBadge>
                </span>
                <UIcon
                  name="i-lucide-chevron-down"
                  class="size-4 text-muted transition-transform"
                  :class="{ 'rotate-180': usedReferralRewardsOpen }"
                />
              </button>
              <div v-if="usedReferralRewardsOpen" class="mt-2 space-y-2">
                <p v-if="!usedReferralRewardIds.length" class="px-1 py-2 text-sm text-muted">
                  暂无已使用额度
                </p>
                <template v-else>
                  <div
                    v-for="rewardId in usedReferralRewardIds"
                    :key="rewardId"
                    class="flex items-center gap-2 rounded-md bg-elevated px-3 py-2"
                  >
                    <UIcon name="i-lucide-circle-check" class="size-4 shrink-0 text-success" />
                    <span class="min-w-0 truncate font-mono text-sm text-muted" :title="rewardId">
                      {{ rewardId }}
                    </span>
                  </div>
                </template>
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

    <AppConfirmDialog
      v-model:open="deleteDialogOpen"
      :title="deleteDialogTitle"
      :description="deleteDialogDescription"
      :loading="deleteConfirmLoading"
      @confirm="confirmDelete"
    />
  </div>
</template>
