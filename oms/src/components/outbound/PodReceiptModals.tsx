import { useEffect, useRef, useState } from 'react'
import { Upload, X, FileCheck, Eye, Download } from 'lucide-react'
import { Button, MonoCode } from '../ui'
import type { LogisticsRecord } from '../../data/mockData'
import { uploadPodReceipt } from '../../data/logisticsStore'
import { readFileAsDataUrl } from '../../data/fileUtils'
import { getOutboundPodFileUrl } from '../../api/erp'
import { fetchWithAuth } from '../../api/client'

function podBadgeClass(status: LogisticsRecord['podStatus']) {
  if (status === 'uploaded') return 'bg-emerald-100 text-emerald-800'
  if (status === 'pending') return 'bg-amber-100 text-amber-800'
  return 'bg-slate-100 text-slate-500'
}

function ghostLinkClass(size: 'sm' | 'md' = 'sm') {
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
  return `${base} ${size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`
}

function isPdfFile(name?: string, url?: string) {
  const lower = (name || url || '').toLowerCase()
  return lower.endsWith('.pdf') || url?.startsWith('data:application/pdf')
}

async function downloadPodFile(outboundNo: string, fileName: string) {
  const response = await fetchWithAuth(getOutboundPodFileUrl(outboundNo))
  if (!response.ok) throw new Error(await response.text().catch(() => response.statusText))
  const objectUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

export function PodStatusBadge({ status }: { status: LogisticsRecord['podStatus'] }) {
  if (status === 'not_required') return <span className="text-xs text-text-muted">—</span>
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${podBadgeClass(status)}`}>
      {status === 'uploaded' ? '已回传' : '待回传'}
    </span>
  )
}

export function PodUploadModal({
  record,
  customerCode,
  onClose,
}: {
  record: LogisticsRecord | null
  customerCode?: string
  onClose: () => void
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!record) return null

  const handleUpload = async () => {
    if (!selectedFile) return
    setUploading(true)
    setError(null)
    try {
      const url = await readFileAsDataUrl(selectedFile)
      const result = await uploadPodReceipt(record.id, selectedFile.name, url, customerCode)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onClose()
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-border-light" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-text-primary">回传签收单</h3>
            <p className="mt-1 text-xs text-text-muted">
              出库单 <MonoCode>{record.outboundNo}</MonoCode> · {record.destination}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-text-muted hover:bg-surface-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <p className="text-xs text-text-secondary">请上传平台仓签收回执，支持 PDF、JPG、PNG，单文件不超过 10MB。</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-surface-muted/30 px-4 py-8 text-center hover:border-primary-400"
          >
            <Upload className="h-6 w-6 text-text-muted" />
            <p className="mt-2 text-sm font-medium text-text-primary">
              {selectedFile ? selectedFile.name : '点击选择签收单文件'}
            </p>
          </button>
        </div>
        {error && (
          <p className="mt-3 text-xs text-red-600">{error}</p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button disabled={!selectedFile || uploading} onClick={() => void handleUpload()}>
            {uploading ? '回传中…' : '确认回传'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function PodViewModal({
  record,
  onClose,
}: {
  record: LogisticsRecord | null
  onClose: () => void
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const blobUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!record || record.podStatus !== 'uploaded') return

    if (record.podFileUrl) {
      setPreviewUrl(record.podFileUrl)
      return
    }

    let cancelled = false
    setLoading(true)
    setLoadError(null)
    void fetchWithAuth(getOutboundPodFileUrl(record.outboundNo, true))
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text().catch(() => res.statusText))
        return res.blob()
      })
      .then((blob) => {
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        blobUrlRef.current = url
        setPreviewUrl(url)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : '加载签收单失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [record?.id, record?.outboundNo, record?.podFileUrl, record?.podStatus])

  if (!record || record.podStatus !== 'uploaded') return null

  const fileName = record.podFileName || `POD-${record.outboundNo}`
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-border-light" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-text-primary">签收单详情</h3>
            <p className="mt-1 text-xs text-text-muted">
              出库单 <MonoCode>{record.outboundNo}</MonoCode>
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-text-muted hover:bg-surface-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted">文件名</dt>
            <dd className="font-mono text-xs text-text-primary">{fileName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted">回传时间</dt>
            <dd className="text-text-primary">{record.podUploadedAt ?? '—'}</dd>
          </div>
          {record.podCode && (
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">仓库 POD 码</dt>
              <dd className="font-mono text-xs text-text-primary">{record.podCode}</dd>
            </div>
          )}
        </dl>
        {loading ? (
          <p className="mt-4 text-xs text-text-muted">加载签收单…</p>
        ) : loadError ? (
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-100">
            <FileCheck className="h-5 w-5 shrink-0 text-amber-600" />
            <p className="text-xs text-amber-800">{loadError}</p>
          </div>
        ) : previewUrl ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-border-light bg-surface-muted/30 p-2">
            {isPdfFile(fileName, previewUrl) ? (
              <iframe title="POD" src={previewUrl} className="h-64 w-full rounded-lg bg-white" />
            ) : (
              <img src={previewUrl} alt="POD" className="mx-auto max-h-72 rounded-lg object-contain" />
            )}
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-100">
            <FileCheck className="h-5 w-5 shrink-0 text-amber-600" />
            <p className="text-xs text-amber-800">暂无预览，请下载查看。</p>
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>关闭</Button>
          <button
            type="button"
            className={ghostLinkClass('md') + ' bg-primary-600 text-white shadow-sm hover:bg-primary-700 hover:text-white'}
            onClick={() => void downloadPodFile(record.outboundNo, fileName).catch(error => {
              setLoadError(error instanceof Error ? error.message : '下载签收单失败')
            })}
          >
            <Download className="h-3 w-3" /> 下载签收单
          </button>
        </div>
      </div>
    </div>
  )
}

export function PodRowActions({
  record,
  onUpload,
  onView,
}: {
  record?: LogisticsRecord
  onUpload: (r: LogisticsRecord) => void
  onView: (r: LogisticsRecord) => void
}) {
  if (!record || record.podStatus === 'not_required') return null
  if (record.podStatus === 'pending') {
    return (
      <Button variant="ghost" size="sm" onClick={() => onUpload(record)}>
        <Upload className="h-3 w-3" /> 回传签收单
      </Button>
    )
  }
  if (record.podStatus === 'uploaded') {
    return (
      <>
        <Button variant="ghost" size="sm" onClick={() => onView(record)}>
          <Eye className="h-3 w-3" /> 查看签收单
        </Button>
        <button
          type="button"
          className={ghostLinkClass('sm')}
          onClick={() => void downloadPodFile(
            record.outboundNo,
            record.podFileName || `POD-${record.outboundNo}`,
          ).catch(error => window.alert(error instanceof Error ? error.message : '下载签收单失败'))}
        >
          <Download className="h-3 w-3" /> 下载
        </button>
      </>
    )
  }
  return null
}
