export const EXPORT_LEASE_MS = 120_000
export const EXPORT_HEARTBEAT_MS = 30_000
export const EXPORT_DEADLINE_MS = 10 * 60_000
export const LEGACY_EXPORT_WAIT_MS = 15 * 60_000

export function exportRecovery(job: {
  jobType: string; status: string; executionToken?: string | null; leaseUntil?: Date | string | null
  startedAt?: Date | string | null; createdAt?: Date | string | null
}, now = Date.now()) {
  if (job.jobType !== 'export' || job.status !== 'processing') return { interrupted: false, legacyRestart: false }
  const lease = job.leaseUntil ? new Date(job.leaseUntil).getTime() : NaN
  const start = new Date(job.startedAt || job.createdAt || '').getTime()
  return {
    interrupted: Boolean(job.executionToken && Number.isFinite(lease) && lease <= now),
    legacyRestart: !job.executionToken && !job.leaseUntil && Number.isFinite(start) && start <= now - LEGACY_EXPORT_WAIT_MS,
  }
}
