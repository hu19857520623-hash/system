import { useSyncExternalStore } from 'react'
import { apiPut } from '../api/client'
import { notifyPersistFailed } from '../utils/userNotify'
import type { LogisticsRecord } from './mockData'

let records: LogisticsRecord[] = []
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(fn => fn())
}

function persist(next: LogisticsRecord[]) {
  records = next
  emit()
  void apiPut('/logistics', next).catch(err => notifyPersistFailed('物流配置', err))
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return records
}

export function hydrateLogistics(next: LogisticsRecord[]) {
  records = structuredClone(next)
  emit()
}

export function useLogisticsRecords(): LogisticsRecord[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function mergeLogisticsRecord(prev: LogisticsRecord | undefined, incoming: Partial<LogisticsRecord>): LogisticsRecord {
  if (!prev) return incoming as LogisticsRecord
  return {
    ...prev,
    ...incoming,
    podFileName: incoming.podFileName ?? prev.podFileName,
    podFileUrl: incoming.podFileUrl ?? prev.podFileUrl,
    podUploadedAt: incoming.podUploadedAt ?? prev.podUploadedAt,
    podCode: incoming.podCode !== undefined ? incoming.podCode : prev.podCode,
  }
}

export function getLogisticsRecordsSnapshot(): LogisticsRecord[] {
  return records
}

export function upsertLogisticsRecord(record: LogisticsRecord, options: { persist?: boolean } = {}) {
  const apply = (next: LogisticsRecord[]) => { if (options.persist === false) { records = next; emit() } else persist(next) }
  const idx = records.findIndex(r => r.id === record.id || r.outboundNo === record.outboundNo)
  if (idx >= 0) {
    const next = [...records]
    next[idx] = mergeLogisticsRecord(next[idx], record)
    apply(next)
    return
  }
  apply([record, ...records])
}

export async function refreshLogisticsFromErp(customerCode: string): Promise<number> {
  const { syncErpLogistics } = await import('../api/erp')
  const data = await syncErpLogistics(customerCode)
  for (const item of data.items || []) {
    upsertLogisticsRecord({
      id: item.id,
      refNo: item.refNo,
      outboundNo: item.outboundNo,
      carrier: item.carrier,
      trackingNo: item.trackingNo,
      status: item.status,
      destination: item.destination,
      updatedAt: item.updatedAt,
      podStatus: item.podStatus,
      podCode: item.podCode ?? null,
      podFileName: item.podFileName ?? undefined,
      podUploadedAt: item.podUploadedAt ?? undefined,
    }, { persist: false })
  }
  return data.total
}
