import type { FileAttachment } from './mockData'

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

export async function fileToAttachment(file: File, kind: string): Promise<FileAttachment> {
  const url = await readFileAsDataUrl(file)
  const now = new Date()
  const uploadedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return {
    kind,
    fileName: file.name,
    url,
    uploadedAt,
  }
}

export function todayDateInput(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/** 转为 datetime-local 控件值 YYYY-MM-DDTHH:mm */
export function toDatetimeLocalInput(value?: string | null): string {
  if (!value?.trim()) return ''
  const raw = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00`
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw)) {
    return raw.replace(' ', 'T').slice(0, 16)
  }
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 从 datetime-local 存为 YYYY-MM-DD HH:mm */
export function fromDatetimeLocalInput(value: string): string | undefined {
  const v = value.trim()
  if (!v) return undefined
  return v.replace('T', ' ').slice(0, 16)
}

/** 展示预计到货：YYYY-MM-DD HH:mm */
export function formatDatetimeDisplay(value?: string | null): string {
  if (!value?.trim()) return '—'
  const local = toDatetimeLocalInput(value)
  if (!local) return value.trim()
  return local.replace('T', ' ')
}
