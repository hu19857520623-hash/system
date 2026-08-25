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

async function persistOrThrow(next: LogisticsRecord[]) {
  const before = records
  records = next
  emit()
  try {
    await apiPut('/logistics', next)
  } catch (error) {
    records = before
    emit()
    throw error
  }
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

export async function uploadPodReceipt(
  recordId: string,
  fileName: string,
  fileUrl: string,
  customerCode?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date()
  const uploadedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const target = records.find(r => r.id === recordId)
  if (!target) return { ok: false, error: '物流记录不存在' }

  const updated: LogisticsRecord = {
    ...target,
    podStatus: 'uploaded',
    podFileName: fileName,
    podFileUrl: fileUrl,
    podUploadedAt: uploadedAt,
    status: target.status === 'exception' ? target.status : 'delivered',
    updatedAt: uploadedAt,
  }

  if (customerCode && customerCode !== '—') {
    try {
      const { uploadPodToErp } = await import('../api/erp')
      const base64 = fileUrl.includes(',') ? fileUrl.split(',')[1] : ''
      if (base64) {
        await uploadPodToErp(target.outboundNo, {
          customerCode,
          fileName,
          contentBase64: base64,
        })
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'POD 已保存本地，但同步 ERP 失败',
      }
    }
  }

  try {
    await persistOrThrow(records.map(r => r.id === recordId ? updated : r))
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: `POD 已同步 ERP，但本地保存失败，请刷新后重试：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function getLogisticsRecordsSnapshot(): LogisticsRecord[] {
  return records
}

export function upsertLogisticsRecord(record: LogisticsRecord) {
  const idx = records.findIndex(r => r.id === record.id || r.outboundNo === record.outboundNo)
  if (idx >= 0) {
    const next = [...records]
    next[idx] = mergeLogisticsRecord(next[idx], record)
    persist(next)
    return
  }
  persist([record, ...records])
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
    })
  }
  return data.total
}
