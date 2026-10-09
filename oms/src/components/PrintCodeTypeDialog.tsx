import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './ui'
import type { LabelCodeType } from '../data/barcodeLabelTemplate'

export function PrintCodeTypeDialog({ title, initialType = 'qr', onClose, onConfirm }: {
  title: string
  initialType?: LabelCodeType
  onClose: () => void
  onConfirm: (type: LabelCodeType) => Promise<boolean | void>
}) {
  const [codeType, setCodeType] = useState<LabelCodeType>(initialType)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const firstOption = useRef<HTMLInputElement>(null)
  useEffect(() => { firstOption.current?.focus() }, [])
  const confirm = async () => {
    setBusy(true)
    setError('')
    try { if (await onConfirm(codeType) !== false) onClose() }
    catch (e) { setError(e instanceof Error ? e.message : '标签生成失败，请重试') }
    finally { setBusy(false) }
  }
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" onKeyDown={e => {
      if (e.key === 'Escape' && !busy) onClose()
      if (e.key === 'Tab') {
        const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)'))
        const target = e.target as HTMLElement
        if (e.shiftKey && target === controls[0]) { e.preventDefault(); controls.at(-1)?.focus() }
        else if (!e.shiftKey && target === controls.at(-1)) { e.preventDefault(); controls[0]?.focus() }
      }
    }}>
      <section role="dialog" aria-modal="true" aria-label="选择打印码类型" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold">{title} · 选择打印码类型</h2>
        <div className="my-5 grid grid-cols-2 gap-3">
          {(['qr', 'barcode'] as const).map((type, index) => (
            <label key={type} className={`flex cursor-pointer items-center gap-2 rounded-lg border p-4 ${codeType === type ? 'border-primary-500 bg-primary-50' : 'border-border-light'}`}>
              <input ref={index === 0 ? firstOption : undefined} type="radio" name="print-code-type" value={type} checked={codeType === type} disabled={busy} onChange={() => setCodeType(type)} />
              {type === 'qr' ? '二维码' : '条形码'}
            </label>
          ))}
        </div>
        {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>取消</Button>
          <Button disabled={busy} onClick={() => void confirm()}>{busy ? '生成中…' : '打印预览'}</Button>
        </div>
      </section>
    </div>, document.body,
  )
}
