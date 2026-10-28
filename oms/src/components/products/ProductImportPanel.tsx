import { useRef, useState } from 'react'
import { Button, Card } from '../ui'
import { useRole } from '../../auth/RoleContext'
import { currentProductWriteScope } from '../../auth/productAccess'
import { apiGet, apiPost, authSessionScope } from '../../api/client'
import { bootstrapFromApi } from '../../data/DataBootstrap'
import { getProductsSnapshot } from '../../data/inventoryStore'
import { importCsvFile } from '../../data/csvImportExport'
import { PRODUCT_COLUMNS, parseProducts } from '../../data/importTemplates'
import { PRODUCT_IMPORT_LIMIT } from '../../data/productImportContract'
import { clearProductImportAttempt, prepareProductImport, readProductImportAttempt, runProductImportAttempt, saveProductImportAttempt, type ProductImportAttempt, type ProductImportReceipt } from '../../data/productImportWorkflow'
import { downloadImportFailuresCsv, formatImportFailureLine, type ImportRowFailure } from '../../utils/importFailureDetail'
import { userFacingError } from '../../utils/userFacingError'

export default function ProductImportPanel({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const { user } = useRole()
  const [initial] = useState(() => {
    try { return { attempt: user?.id && user.customerId ? readProductImportAttempt(localStorage, user.id, user.customerId) : null, error: '' } }
    catch (error) { return { attempt: null, error: userFacingError(error) } }
  })
  const [attempt, setAttempt] = useState<ProductImportAttempt | null>(initial.attempt)
  const [pending, setPending] = useState(Boolean(initial.attempt))
  const [error, setError] = useState(initial.error)
  const [storageBlocked] = useState(Boolean(initial.error))
  const [message, setMessage] = useState('')
  const [failures, setFailures] = useState<ImportRowFailure[]>(initial.attempt?.failures || [])
  const [completed, setCompleted] = useState<'confirmed' | 'cancelled' | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  async function selectFile() {
    if (inFlight.current || pending || storageBlocked) return
    const owner = currentProductWriteScope()
    if (!owner) { setError('当前账号没有商品维护权限，请联系管理员核对'); return }
    if (!user?.customerId || !user.customerCode || user.customerCode === '—') { setError('请先使用已绑定客户编码的客户账号导入商品'); return }
    inFlight.current = true; setBusy(true); setError(''); setMessage(''); setCompleted(null); setAttempt(null); setFailures([])
    try {
      // Recheck other tabs before opening a new batch.
      const existing = readProductImportAttempt(localStorage, user.id, user.customerId)
      if (existing) { setAttempt(existing); setFailures(existing.failures); setPending(true); setMessage('发现原导入批次，请先核对原批次'); return }
      const parsed = await importCsvFile(PRODUCT_COLUMNS, rows => parseProducts(rows, user.customerId!))
      if (owner !== currentProductWriteScope()) return
      const result = prepareProductImport(parsed, getProductsSnapshot(), user.customerId, user.customerCode)
      setFailures(result.failures)
      if (!result.products.length) { setMessage(result.failures.length ? '没有可导入的有效商品，请下载失败明细，修正文件后重新选择' : '未读取到商品，请使用最新模板重新选择文件'); return }
      setAttempt({ requestId: crypto.randomUUID(), userId: user.id, customerId: user.customerId, ...result })
      setMessage('文件已读取，尚未提交。请核对下方数量后导入有效商品')
    } catch (cause) { if (owner === currentProductWriteScope() && !(cause instanceof Error && cause.message === 'cancelled')) setError(userFacingError(cause)) }
    finally { inFlight.current = false; setBusy(false) }
  }

  async function run(mode: 'submit' | 'check' | 'cancel') {
    if (inFlight.current || !attempt || completed) return
    const owner = currentProductWriteScope(), original = attempt
    if (!owner) { setError('当前账号没有商品维护权限，请联系管理员核对原批次'); return }
    if (user?.id !== original.userId || user.customerId !== original.customerId) { setError('请使用原客户账号核对导入批次'); return }
    inFlight.current = true; setBusy(true); setError(''); setMessage('正在核对原导入批次…')
    try {
      if (!pending) { saveProductImportAttempt(localStorage, original); setPending(true) }
      const path = `/inventory-products/imports/${original.requestId}`
      const receipt = await runProductImportAttempt(() => mode === 'check' ? apiGet<ProductImportReceipt>(path)
        : apiPost<ProductImportReceipt>(`${path}${mode === 'cancel' ? '/cancel' : ''}`, mode === 'cancel' ? {} : { products: original.products }), original, owner, currentProductWriteScope)
      if (receipt.status === 'unknown') { setMessage('暂未查到已完成的回执；原请求仍可能处理中。可继续原批次，或取消原批次后修正文件'); return }
      if (receipt.status === 'confirmed') {
        setMessage(`已确认导入${receipt.count}个商品草稿，正在刷新列表…`)
        await bootstrapFromApi(authSessionScope(), true)
        if (owner !== currentProductWriteScope()) return
        setMessage(`已确认导入${receipt.count}个商品草稿。请返回列表，在草稿页继续审核；再次核对不会覆盖商品后续修改`)
      } else setMessage('已取消原批次，本批有效行也未保存。请修正后重新选择完整文件')
      clearProductImportAttempt(localStorage, original); setPending(false); setCompleted(receipt.status)
    } catch (cause) {
      if (owner === currentProductWriteScope()) setError(`${userFacingError(cause)}。请保留原批次，核对结果后继续；已导入的商品不会因取消而删除`)
    } finally { inFlight.current = false; setBusy(false) }
  }

  if (!open) return pending || storageBlocked ? <Card className="mb-4"><p>有原商品导入批次待核对，请勿重复导入。</p><Button size="sm" onClick={onOpen}>核对原导入批次</Button></Card> : null
  return <Card className="mb-4 space-y-3">
    <h2 className="font-semibold">导入商品草稿</h2>
    <p className="text-sm">单次最多{PRODUCT_IMPORT_LIMIT}条商品；超出请拆分文件。有效行保存为草稿，失败行保留原文件行号。</p>
    {attempt && <p className="text-sm">本批共{attempt.rowCount}行，可导入{attempt.products.length}行，失败{new Set(failures.map(row => row.lineNo)).size}行。批次：{attempt.requestId}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {!!failures.length && <div className="space-y-2">
      <p className="text-sm">{completed === 'confirmed' ? '以下行未导入；下载明细后，只修正和重传失败行。'
        : completed === 'cancelled' ? '以下行未通过文件校验，本批有效行也未保存。请修正后重新导入完整文件。'
          : '以下行未通过文件校验，未纳入有效商品。请先核对本批保存结果，再决定重传范围。'}</p>
      <ul className="max-h-48 overflow-auto text-sm">{failures.slice(0, 40).map((row, index) => <li key={index}>{formatImportFailureLine(row)}</li>)}</ul>
      {failures.length > 40 && <p>共{failures.length}条失败原因，请下载完整明细。</p>}
      <Button size="sm" onClick={() => downloadImportFailuresCsv('OMS-商品导入失败明细', failures)}>下载失败明细CSV</Button>
    </div>}
    <div className="flex flex-wrap gap-2">
      {!pending && !storageBlocked && <Button size="sm" disabled={busy} onClick={() => void selectFile()}>选择导入文件</Button>}
      {attempt && !completed && !storageBlocked && <>
        <Button size="sm" disabled={busy} onClick={() => void run('submit')}>{busy ? '核对中…' : pending ? '继续原批次' : '导入有效商品'}</Button>
        {pending && <>
          <Button size="sm" disabled={busy} onClick={() => void run('check')}>核对结果</Button>
          <Button size="sm" disabled={busy} onClick={() => void run('cancel')}>取消原批次</Button>
        </>}
      </>}
      <Button size="sm" variant="toolbar" disabled={busy} onClick={onClose}>返回商品列表</Button>
    </div>
  </Card>
}
