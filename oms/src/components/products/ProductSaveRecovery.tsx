import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card } from '../ui'
import { currentProductWriteScope } from '../../auth/productAccess'
import { authSessionScope } from '../../api/client'
import { bootstrapFromApi } from '../../data/DataBootstrap'
import { clearProductSaveAttempt, readProductSaveAttempt, requestProductSave, runProductSaveAttempt, type ProductSaveAttempt } from '../../data/productSaveWorkflow'
import type { ProductSaveReceipt } from '../../data/productSaveContract'
import { userFacingError } from '../../utils/userFacingError'

export async function finishProductSave(a: ProductSaveAttempt, result: ProductSaveReceipt, owner: string, isActive: () => boolean = () => true) {
  if (result.status === 'unknown') return false
  await bootstrapFromApi(authSessionScope(), true)
  if (!isActive() || owner !== currentProductWriteScope()) throw new Error('登录身份或页面已变化，请使用原账号核对保存结果')
  clearProductSaveAttempt(localStorage, a)
  return true
}
export default function ProductSaveRecovery({ attempt, onResolved, disabled = false }: { attempt: ProductSaveAttempt; onResolved: (result: ProductSaveReceipt) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('有原商品保存结果待核对，请勿重新创建或更改原保存内容'), [error, setError] = useState('')
  const running = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  async function run(mode: 'submit' | 'check' | 'cancel') {
    const owner = currentProductWriteScope()
    if (running.current || disabled) return
    if (!owner) { setError('当前账号没有商品维护权限，请使用原账号核对'); return }
    running.current = true; setBusy(true); setError(''); setMessage('正在核对原商品保存结果…')
    try {
      const result = await runProductSaveAttempt(() => requestProductSave(mode, attempt), attempt, owner, currentProductWriteScope)
      if (result.status === 'unknown') { setMessage('尚未查到已完成的回执。请继续原保存，或取消原请求后重新编辑'); return }
      if (!active.current) return
      await finishProductSave(attempt, result, owner, () => active.current)
      setMessage(result.status === 'confirmed' ? '原保存已完成，商品列表已刷新；后续编辑不会被原请求覆盖' : '原请求已取消，未更改商品。请重新核对资料后继续编辑')
      onResolved(result)
    } catch (cause) {
      if (active.current && owner === currentProductWriteScope()) { setMessage('原保存结果尚未核实，请选择下方操作继续'); setError(userFacingError(cause)) }
    } finally { running.current = false; setBusy(false) }
  }
  return <Card className="mb-4 space-y-3">
    <h2 className="font-semibold">核对原商品保存</h2>
    <p>商品：{attempt.product.customerSku} · {attempt.product.name}</p>
    <p role="status">{message}</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || disabled} onClick={() => void run('check')}>核对原保存结果</Button>
      <Button disabled={busy || disabled} onClick={() => void run('submit')}>继续原保存</Button>
      <Button disabled={busy || disabled} onClick={() => void run('cancel')}>取消原保存请求</Button>
      <Link to="/products">返回商品列表</Link>
    </div>
    <p className="text-xs">取消只会阻止尚未完成的请求；已确认的保存不会删除或撤销商品。</p>
  </Card>
}

export function ProductSaveBanner({ userId, customerId }: { userId: string; customerId: string }) {
  const [initial] = useState(() => {
    try { return { attempt: readProductSaveAttempt(localStorage, userId, customerId), error: '' } }
    catch (cause) { return { attempt: null, error: userFacingError(cause) } }
  })
  const [attempt, setAttempt] = useState(initial.attempt), [resolved, setResolved] = useState('')
  if (initial.error) return <Card><p role="alert">{initial.error}</p></Card>
  if (attempt) return <ProductSaveRecovery attempt={attempt} onResolved={result => { setAttempt(null); setResolved(result.status === 'confirmed' ? '原商品保存已确认，请从列表继续查看或编辑' : '原商品保存请求已取消，请重新打开商品核对后继续') }} />
  return resolved ? <p role="status">{resolved}</p> : null
}
