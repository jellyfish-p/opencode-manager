<script setup lang="ts">
const { accounts, stats, loading, fetchAccounts, fetchStats, refreshAll } = useAccounts()
const toast = useToast()
const refreshing = ref(false)

await Promise.all([fetchAccounts(), fetchStats()])

const cards = computed(() => [
  { label: '账号总数', value: stats.value?.total ?? 0, icon: 'i-lucide-users', color: 'primary' as const },
  { label: '正常', value: stats.value?.active ?? 0, icon: 'i-lucide-check-circle', color: 'success' as const },
  { label: '异常', value: stats.value?.error ?? 0, icon: 'i-lucide-circle-alert', color: 'error' as const },
  { label: '平均滚动用量', value: `${stats.value?.avgRolling ?? 0}%`, icon: 'i-lucide-activity', color: 'info' as const }
])

const recent = computed(() => accounts.value.slice(0, 5))

async function onRefreshAll() {
  refreshing.value = true
  try {
    await refreshAll()
    toast.add({ title: '已刷新全部账号', color: 'success' })
  } catch (e: any) {
    toast.add({ title: e?.data?.statusMessage || '刷新失败', color: 'error' })
  } finally {
    refreshing.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold text-highlighted">仪表盘</h1>
        <p class="text-sm text-muted">OpenCode 号池概览</p>
      </div>
      <div class="flex gap-2">
        <UButton to="/accounts" icon="i-lucide-plus" color="primary">
          管理号池
        </UButton>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="refreshing || loading"
          @click="onRefreshAll"
        >
          全部刷新
        </UButton>
      </div>
    </div>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <UCard v-for="card in cards" :key="card.label">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-sm text-muted">{{ card.label }}</p>
            <p class="mt-2 text-3xl font-semibold text-highlighted">{{ card.value }}</p>
          </div>
          <div class="rounded-lg bg-elevated p-2">
            <UIcon :name="card.icon" class="size-5" :class="`text-${card.color}`" />
          </div>
        </div>
      </UCard>
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      <UCard class="lg:col-span-2">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-medium text-highlighted">最近账号</h2>
            <UButton to="/accounts" variant="link" color="primary" trailing-icon="i-lucide-arrow-right">
              查看全部
            </UButton>
          </div>
        </template>

        <div v-if="!recent.length" class="py-10 text-center text-muted">
          暂无账号，先去添加 Cookie
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="account in recent"
            :key="account.id"
            class="flex items-center justify-between rounded-lg border border-default p-3"
          >
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <p class="truncate font-medium text-highlighted">
                  {{ account.name || account.email || `账号 #${account.id}` }}
                </p>
                <UBadge :color="statusColor(account.status)" variant="subtle" size="sm">
                  {{ account.status }}
                </UBadge>
              </div>
              <p class="mt-1 truncate text-sm text-muted">
                {{ account.email || '未同步邮箱' }}
                <span v-if="account.workspace_id"> · {{ account.workspace_id }}</span>
              </p>
            </div>
            <div class="text-right text-sm">
              <p class="text-highlighted">滚动 {{ formatPercent(account.rolling_usage) }}</p>
              <p class="text-muted">重置 {{ formatReset(account.rolling_reset_sec) }}</p>
            </div>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-medium text-highlighted">用量统计</h2>
        </template>
        <div class="space-y-4">
          <div>
            <div class="mb-1 flex justify-between text-sm">
              <span class="text-muted">平均滚动</span>
              <span>{{ stats?.avgRolling ?? 0 }}%</span>
            </div>
            <UProgress :model-value="stats?.avgRolling ?? 0" />
          </div>
          <div>
            <div class="mb-1 flex justify-between text-sm">
              <span class="text-muted">平均每周</span>
              <span>{{ stats?.avgWeekly ?? 0 }}%</span>
            </div>
            <UProgress :model-value="stats?.avgWeekly ?? 0" color="info" />
          </div>
          <div>
            <div class="mb-1 flex justify-between text-sm">
              <span class="text-muted">平均每月</span>
              <span>{{ stats?.avgMonthly ?? 0 }}%</span>
            </div>
            <UProgress :model-value="stats?.avgMonthly ?? 0" color="warning" />
          </div>
          <USeparator />
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted">总余额</span>
            <span class="font-medium text-highlighted">${{ stats?.totalBalance?.toFixed?.(2) ?? '0.00' }}</span>
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted">禁用账号</span>
            <span>{{ stats?.disabled ?? 0 }}</span>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
