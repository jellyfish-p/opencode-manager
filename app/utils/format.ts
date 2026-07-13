export function formatReset(seconds: number | null | undefined): string {
  if (seconds == null) return '-'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return m ? `${h}h ${m}m` : `${h}h`
  }
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  return h ? `${d}d ${h}h` : `${d}d`
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return '-'
  return `${value}%`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString('zh-CN')
  } catch {
    return value
  }
}

export function statusColor(status: string): 'success' | 'error' | 'warning' | 'neutral' | 'info' {
  switch (status) {
    case 'active':
      return 'success'
    case 'error':
      return 'error'
    case 'pending':
      return 'warning'
    case 'disabled':
      return 'neutral'
    default:
      return 'info'
  }
}
