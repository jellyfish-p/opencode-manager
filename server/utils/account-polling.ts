export type AccountPollKind = 'quota' | 'membership'

export interface PollableAccount {
  id: number
  disabled_reason: string | null
  next_quota_refresh_at: string | null
  auto_enable_at: string | null
  last_synced_at: string | null
}

interface PollState {
  version: number
  quota: number | null
  membership: number | null
}

interface PollEntry {
  id: number
  at: number
  version: number
}

const MEMBERSHIP_INTERVAL_MS = 15 * 60 * 1000

function timestamp(value: string | null): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function earliest(...values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null)
  return valid.length ? Math.min(...valid) : null
}

class MinHeap {
  private entries: PollEntry[] = []

  get size() {
    return this.entries.length
  }

  clear() {
    this.entries.length = 0
  }

  peek() {
    return this.entries[0]
  }

  push(entry: PollEntry) {
    const entries = this.entries
    entries.push(entry)
    let index = entries.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (entries[parent]!.at <= entry.at) break
      entries[index] = entries[parent]!
      index = parent
    }
    entries[index] = entry
  }

  pop() {
    const entries = this.entries
    const root = entries[0]
    const tail = entries.pop()
    if (!root || !tail || !entries.length) return root

    let index = 0
    while (true) {
      const left = index * 2 + 1
      if (left >= entries.length) break
      const right = left + 1
      const child = right < entries.length && entries[right]!.at < entries[left]!.at ? right : left
      if (entries[child]!.at >= tail.at) break
      entries[index] = entries[child]!
      index = child
    }
    entries[index] = tail
    return root
  }
}

export class AccountPollSchedule {
  private states = new Map<number, PollState>()
  private heaps: Record<AccountPollKind, MinHeap> = {
    quota: new MinHeap(),
    membership: new MinHeap()
  }

  hydrate(accounts: PollableAccount[], now = Date.now()) {
    this.states.clear()
    this.heaps.quota.clear()
    this.heaps.membership.clear()
    for (const account of accounts) this.schedule(account, now, true)
  }

  schedule(account: PollableAccount, now = Date.now(), includeOverdue = false) {
    const previousVersion = this.states.get(account.id)?.version || 0
    const version = previousVersion + 1
    if (account.disabled_reason === 'manual') {
      this.states.set(account.id, { version, quota: null, membership: null })
      return
    }

    const rawQuota = earliest(
      timestamp(account.next_quota_refresh_at),
      timestamp(account.auto_enable_at)
    )
    const quota = rawQuota !== null && (includeOverdue || rawQuota > now) ? rawQuota : null
    const lastSynced = timestamp(account.last_synced_at)
    const membership = lastSynced === null ? now : Math.max(now, lastSynced + MEMBERSHIP_INTERVAL_MS)
    const state = { version, quota, membership }
    this.states.set(account.id, state)
    if (quota !== null) this.heaps.quota.push({ id: account.id, at: quota, version })
    this.heaps.membership.push({ id: account.id, at: membership, version })
    this.compactIfNeeded('quota')
    this.compactIfNeeded('membership')
  }

  remove(id: number) {
    this.states.delete(id)
  }

  takeDue(kind: AccountPollKind, now = Date.now()): number[] {
    const due: number[] = []
    const heap = this.heaps[kind]
    while (heap.peek() && heap.peek()!.at <= now) {
      const entry = heap.pop()!
      const state = this.states.get(entry.id)
      if (!state || state.version !== entry.version || state[kind] !== entry.at) continue
      state[kind] = null
      due.push(entry.id)
    }
    return due
  }

  private compactIfNeeded(kind: AccountPollKind) {
    const heap = this.heaps[kind]
    if (heap.size <= this.states.size * 4 + 64) return
    heap.clear()
    for (const [id, state] of this.states) {
      const at = state[kind]
      if (at !== null) heap.push({ id, at, version: state.version })
    }
  }
}
