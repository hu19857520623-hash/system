import { useEffect, useRef, useState } from 'react'
import { Button, Card } from '../ui'
import { currentProductWriteScope } from '../../auth/productAccess'
import { authSessionScope } from '../../api/client'
import { bootstrapFromApi } from '../../data/DataBootstrap'
import { buildProductAction, clearProductAction, readProductAction, requestProductAction, runProductAction, storeProductAction, type ActionActor, type ProductActionIntent } from '../../data/productActionWorkflow'
import { productActionLabels } from '../../data/productActionContract'
import { downloadCsv } from '../../data/csvImportExport'
import { userFacingError } from '../../utils/userFacingError'
import { notifyError, notifySuccess } from '../../utils/userNotify'

export default function ProductActionPanel({ actor, intent, onConsumed, onApplied }: { actor: ActionActor; intent: ProductActionIntent | null; onConsumed: () => void; onApplied: (ids: string[]) => void }) {
  const [initial] = useState(() => { try { return { attempt: readProductAction(localStorage, actor), error: '' } } catch (cause) { return { attempt: null, error: userFacingError(cause) } } })
  const [attempt, setAttempt] = useState(initial.attempt), [pending, setPending] = useState(Boolean(initial.attempt)), [open, setOpen] = useState(Boolean(initial.attempt || initial.error))
  const [failures, setFailures] = useState(initial.attempt?.failures || [])
  const [busy, setBusy] = useState(false), [error, setError] = useState(initial.error), [message, setMessage] = useState('')
  const [completed, setCompleted] = useState(false)
  const active = useRef(true), running = useRef(false), seen = useRef<ProductActionIntent | null>(null)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])

  async function perform(mode: 'submit' | 'check' | 'cancel', a = attempt) {
    const owner = currentProductWriteScope()
    if (!a || !owner || running.current) return
    running.current = true; setBusy(true); setError(''); setMessage('正在核对原商品操作…')
    try {
      const stored = readProductAction(localStorage, actor)
      if (!stored) { storeProductAction(localStorage, actor, a); setPending(true) }
      else if (stored.requestId !== a.requestId) throw new Error('还有其他原商品操作待核对，请刷新列表处理')
      const result = await runProductAction(() => requestProductAction(mode, a), a, owner, currentProductWriteScope)
      if (!active.current) return
      if (result.status === 'unknown') { setMessage('尚未查到已完成的回执，请继续原操作，或取消原操作后刷新列表重新选择'); return }
      await bootstrapFromApi(authSessionScope(), true)
      if (!active.current || owner !== currentProductWriteScope()) return
      clearProductAction(localStorage, actor, a); setPending(false); setCompleted(true)
      const text = result.status === 'cancelled' ? '原商品操作已取消，列表已刷新，请重新核对后继续'
        : a.action === 'restore' ? '商品已恢复，请按列表中的最新状态继续编辑或审核；历史来源不明或资料不完整的商品恢复为草稿'
          : `${productActionLabels[a.action]}已确认，共${a.items.length}个商品，列表已刷新`
      setMessage(text); notifySuccess(text)
      if (result.status === 'confirmed') onApplied(result.productIds!)
    } catch (cause) {
      if (active.current && owner === currentProductWriteScope()) { setMessage('原商品操作结果尚未核实，请选择下方操作继续'); setError(userFacingError(cause)) }
    } finally { running.current = false; if (active.current) setBusy(false) }
  }

  useEffect(() => {
    if (!intent || seen.current === intent) return
    seen.current = intent
    const owner = currentProductWriteScope()
    if (!owner) { onConsumed(); return }
    try {
      const original = readProductAction(localStorage, actor)
      if (original) { setAttempt(original); setFailures(original.failures); setPending(true); setOpen(true); setCompleted(false); notifyError('请先核对或取消原商品操作，再开始新的操作'); return }
      setError(''); setMessage(''); setCompleted(false); setPending(false)
      setFailures(intent.failures || [])
      if (!intent.products.length) { setAttempt(null); setOpen(true); setMessage('没有通过校验的商品，请根据失败明细编辑后重新审核'); return }
      const a = buildProductAction(intent, actor)
      setAttempt(a); setOpen(true); setCompleted(false); setPending(false); setError(''); setMessage('请核对所选商品，确认废弃后可在废弃页恢复')
      if (a.action !== 'discard') void perform('submit', a)
    } catch (cause) { setError(userFacingError(cause)); setOpen(true) }
    finally { onConsumed() }
  }, [intent])

  if (!open) return pending ? <Card className="mb-4"><p>有原商品操作待核对，请勿重复操作。</p><Button onClick={() => setOpen(true)}>核对原商品操作</Button></Card> : null
  return <Card className="mb-4 space-y-3">
    <h2 className="font-semibold">{attempt ? productActionLabels[attempt.action] : '商品操作核对'}</h2>
    {attempt && <ul className="max-h-40 overflow-auto text-sm">{attempt.labels.map((label,index) => <li key={index}>{label}</li>)}</ul>}
    {!!failures.length && <div><p>以下商品未通过审核校验，仍保留原状态，请编辑后重新审核：</p><ul>{failures.map((row,index) => <li key={index}>{row.sku}：{row.error}</li>)}</ul><Button onClick={() => downloadCsv('OMS-商品审核失败明细.csv', [['SKU', '失败原因'], ...failures.map(row => [row.sku, row.error])])}>下载审核失败明细</Button></div>}
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="text-red-600">{error}</p>}
    <div className="flex flex-wrap gap-2">
      {attempt && !completed && <>
        <Button disabled={busy} onClick={() => void perform('submit')}>{pending ? '继续原商品操作' : attempt.action === 'discard' ? '确认废弃' : `继续${productActionLabels[attempt.action]}`}</Button>
        {pending && <><Button disabled={busy} onClick={() => void perform('check')}>核对商品操作结果</Button><Button disabled={busy} onClick={() => void perform('cancel')}>取消原商品操作</Button></>}
      </>}
      <Button disabled={busy} onClick={() => { setOpen(false); if (!pending) { setAttempt(null); setMessage(''); setError('') } }}>返回商品列表</Button>
    </div>
  </Card>
}
