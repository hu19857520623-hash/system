import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Upload, Plus, Trash2, ListOrdered } from 'lucide-react'
import { Button, Card, MonoCode, Table } from '../components/ui'
import { FormSection, FormGrid, FormField, formInput, formSelect, formTextarea } from '../components/ui/form'
import { findProductByCode } from '../data/platformBindingUtils'
import { useRole } from '../auth/RoleContext'
import { getCustomerIdForRole } from '../data/dataScope'
import { addInboundOrder, nextInboundNo, submitInboundToErp } from '../data/inboundStore'
import { notifyIfUserError } from '../utils/userNotify'
import { fileToAttachment, todayDateInput } from '../data/fileUtils'
import { importCsvFile } from '../data/csvImportExport'
import {
  INBOUND_LINE_COLUMNS,
  downloadInboundLineTemplate,
  parseInboundLines,
} from '../data/importTemplates'
import { ImportTemplateLegend } from '../components/ui/ImportTemplateLegend'
import SkuFuzzyPicker from '../components/ui/SkuFuzzyPicker'
import type { DeliveryMethod, FileAttachment, InboundStatus, InboundType, StockSource } from '../data/mockData'
import { updateInboundOrder, useInboundOrders } from '../data/entityStore'

const INBOUND_WAREHOUSE_ID = 'jhb1'

interface LineItem {
  id: string
  sku: string
  name: string
  qty: number
  boxNo: number
  packType: string
  stockType: string
}

export default function Inbound() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('edit')
  const inboundOrders = useInboundOrders()
  const editOrder = editId ? inboundOrders.find(order => order.id === editId && order.status === 'draft') : undefined
  const { role } = useRole()
  const [delivery, setDelivery] = useState<'self' | 'pickup'>('self')
  const [entryMode, setEntryMode] = useState<'sequential' | 'simple'>('sequential')
  const [inboundType, setInboundType] = useState(role === 'catalog' ? '货盘入库' : '自发头程')
  const [eta, setEta] = useState('')
  const [trackingNo, setTrackingNo] = useState('')
  const [referenceNo, setReferenceNo] = useState('')
  const [platformRef, setPlatformRef] = useState('')
  const [remark, setRemark] = useState('')
  const [skuInput, setSkuInput] = useState('')
  const [qtyInput, setQtyInput] = useState('')
  const [boxInput, setBoxInput] = useState('')
  const [packTypeInput, setPackTypeInput] = useState('自带包装')
  const [stockTypeInput, setStockTypeInput] = useState('以仓库为准')
  const [lines, setLines] = useState<LineItem[]>([])
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const [confirmWarehouseData, setConfirmWarehouseData] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hydratedEditId = useRef<string | null>(null)

  useEffect(() => {
    if (!editOrder || hydratedEditId.current === editOrder.id) return
    hydratedEditId.current = editOrder.id
    setDelivery(editOrder.deliveryMethod === 'pickup' ? 'pickup' : 'self')
    setInboundType(editOrder.inboundType || (role === 'catalog' ? '货盘入库' : '自发头程'))
    setEta(editOrder.eta || '')
    setTrackingNo(editOrder.trackingNo || '')
    setReferenceNo(editOrder.referenceNo || '')
    setRemark(editOrder.remark || '')
    setLines((editOrder.lineItems || []).map((line, index) => ({
      id: `${editOrder.id}-${index}`,
      sku: line.sku,
      name: line.name,
      qty: line.qty,
      boxNo: line.boxNo || index + 1,
      packType: line.packType || '自带包装',
      stockType: line.stockType || '以仓库为准',
    })))
    setAttachments(editOrder.attachments || [])
  }, [editOrder, role])

  const addLine = () => {
    if (!skuInput || !qtyInput) return
    const prod = findProductByCode(skuInput)
    setLines(prev => [...prev, {
      id: String(Date.now()),
      sku: skuInput,
      name: prod?.name ?? skuInput,
      qty: Number(qtyInput),
      boxNo: Number(boxInput) || prev.length + 1,
      packType: packTypeInput,
      stockType: stockTypeInput,
    }])
    setSkuInput(''); setQtyInput(''); setBoxInput('')
  }

  const handleBatchUploadLines = async () => {
    try {
      const { data, errors } = await importCsvFile(INBOUND_LINE_COLUMNS, parseInboundLines)
      if (errors.length > 0) {
        window.alert(`导入失败：\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? `\n…共 ${errors.length} 条` : ''}`)
        return
      }
      if (data.length === 0) {
        window.alert('未解析到有效明细，请使用最新模板')
        return
      }
      setLines(prev => [...prev, ...data.map(row => ({
        id: row.id,
        sku: row.sku,
        name: row.name,
        qty: row.qty,
        boxNo: row.boxNo,
        packType: row.packType ?? '自带包装',
        stockType: row.stockType ?? '以仓库为准',
      }))])
      window.alert(`已导入 ${data.length} 行入库明细`)
    } catch (err) {
      notifyIfUserError(err, '导入失败')
    }
  }

  const goRecords = () => navigate('/inbound/records')

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const next: FileAttachment[] = []
    for (const file of Array.from(files)) {
      next.push(await fileToAttachment(file, 'inbound_doc'))
    }
    setAttachments(prev => [...prev, ...next])
  }

  const handleSubmit = async (asDraft = false) => {
    if (!asDraft && !confirmWarehouseData) {
      window.alert('请先勾选「以仓库收货数据为准」后再提交')
      return
    }
    if (lines.length === 0) {
      window.alert('请先添加入库货品')
      return
    }

    const totalQty = lines.reduce((s, l) => s + l.qty, 0)
    const boxCount = new Set(lines.map(l => l.boxNo)).size
    const stockSource: StockSource = role === 'catalog' ? 'catalog' : 'owned'
    const customerId = getCustomerIdForRole(role) ?? undefined

    const localOrder = {
      id: editOrder?.id || `ib-${Date.now()}`,
      customerId,
      inboundNo: editOrder?.inboundNo || nextInboundNo(),
      source: role === 'catalog' ? '货盘' : '客户自发',
      inboundType: inboundType as InboundType,
      deliveryMethod: delivery as DeliveryMethod,
      stockSource,
      boxCount,
      skuCount: new Set(lines.map(l => l.sku)).size,
      totalQty,
      receivedQty: 0,
      status: (asDraft ? 'draft' : 'on_the_way') as InboundStatus,
      createdAt: editOrder?.createdAt || todayDateInput(),
      eta: eta || undefined,
      warehouse: INBOUND_WAREHOUSE_ID,
      referenceNo: referenceNo.trim() || platformRef.trim() || undefined,
      trackingNo: trackingNo.trim() || undefined,
      skuHint: lines.map(l => l.sku).slice(0, 3).join(', '),
      remark: remark.trim() || undefined,
      lineItems: lines.map(l => ({
        sku: l.sku,
        name: l.name,
        qty: l.qty,
        boxNo: l.boxNo,
        packType: l.packType,
        stockType: l.stockType,
      })),
      attachments: attachments.length ? attachments : undefined,
    }

    if (editOrder) updateInboundOrder(editOrder.id, localOrder)
    else addInboundOrder(localOrder)

    if (!asDraft) {
      const erpResult = await submitInboundToErp(localOrder)
      if (!erpResult.ok) {
        updateInboundOrder(localOrder.id, { status: 'draft' })
        window.alert(`同步 ERP 失败，已自动保留为草稿：${erpResult.error}`)
      }
    }

    setLines([])
    setAttachments([])
    setConfirmWarehouseData(false)
    goRecords()
  }

  return (
    <div className="page-shell pb-24">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">预约入库</h1>
        </div>
        <Link to="/inbound/records" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-medium text-text-secondary hover:bg-surface-muted">
          <ListOrdered className="h-3.5 w-3.5" /> 查看入库记录
        </Link>
      </div>

      </div>

      <div className="space-y-4">
        <FormSection num={1} title="入库信息">
          <FormGrid cols={3}>
            <FormField label="目的仓库" required>
              <select value={INBOUND_WAREHOUSE_ID} className={formSelect()} disabled>
                <option value={INBOUND_WAREHOUSE_ID}>{INBOUND_WAREHOUSE_ID}</option>
              </select>
            </FormField>
            <FormField label="入库类型" required>
              <select className={formSelect()} value={inboundType} onChange={e => setInboundType(e.target.value)}>
                {role !== 'catalog' && <option value="自发头程">自发头程</option>}
                {role !== 'catalog' && <option value="中转入库">中转入库</option>}
                {role !== 'catalog' && <option value="退货入库">退货入库</option>}
                {(role === 'catalog' || role === 'hybrid') && <option value="货盘入库">货盘入库</option>}
              </select>
            </FormField>
            <FormField label="交货方式" required>
              <div className="flex gap-4 pt-2 text-sm">
                {([['self', '自送'], ['pickup', '揽收']] as const).map(([v, l]) => (
                  <label key={v} className="flex items-center gap-2">
                    <input type="radio" checked={delivery === v} onChange={() => setDelivery(v)} className="text-primary-600" />
                    {l}
                  </label>
                ))}
              </div>
            </FormField>
            <FormField label="预计到达时间" hint="选填，精确到天，便于仓库安排收货">
              <input type="date" className={formInput()} value={eta} onChange={e => setEta(e.target.value)} />
            </FormField>
            <FormField label="跟踪号/提单号" hint="填写后便于在途跟踪">
              <input className={formInput()} placeholder="Tracking / BL No." value={trackingNo} onChange={e => setTrackingNo(e.target.value)} />
            </FormField>
            <FormField label="参考号">
              <input className={formInput()} placeholder="REF-CUS-xxxx" value={referenceNo} onChange={e => setReferenceNo(e.target.value)} />
            </FormField>
            <FormField label="平台参考号">
              <input className={formInput()} value={platformRef} onChange={e => setPlatformRef(e.target.value)} />
            </FormField>
          </FormGrid>
          <div className="mt-4">
            <FormField label="备注">
              <textarea className={formTextarea()} placeholder="特殊处理说明、到仓要求等" value={remark} onChange={e => setRemark(e.target.value)} />
            </FormField>
          </div>
          <div className="mt-4 flex flex-wrap items-start gap-4">
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => void onPickFiles(e.target.files)} />
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> 上传附件
            </Button>
            {attachments.length > 0 && (
              <p className="pt-1 text-xs text-text-muted">已上传 {attachments.length} 个文件</p>
            )}
            <FormField label="以仓库收货数据为准" required hint="提交前必须确认此项" className="mb-0">
              <label className="flex items-center gap-2 pt-1 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={confirmWarehouseData}
                  onChange={e => setConfirmWarehouseData(e.target.checked)}
                  className="rounded border-border text-primary-600"
                />
                确认以仓库实际收货数量为准
              </label>
            </FormField>
          </div>
        </FormSection>

        <FormSection
          num={2}
          title="货品选择"
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={downloadInboundLineTemplate}>下载模板</Button>
              <Button variant="secondary" size="sm" onClick={() => void handleBatchUploadLines()}>
                <Upload className="h-3.5 w-3.5" /> 批量上传
              </Button>
            </div>
          }
        >
          <ImportTemplateLegend columns={INBOUND_LINE_COLUMNS} />
          <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
            {([['sequential', '按顺序录入'], ['simple', '精简录入']] as const).map(([v, l]) => (
              <label key={v} className="flex items-center gap-2">
                <input type="radio" checked={entryMode === v} onChange={() => setEntryMode(v)} className="text-primary-600" />
                {l}
              </label>
            ))}
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <FormField label="SKU" required>
              <SkuFuzzyPicker
                value={skuInput}
                onChange={setSkuInput}
                customerId={getCustomerIdForRole(role) ?? undefined}
              />
            </FormField>
            <FormField label="数量" required hint="> 0">
              <input value={qtyInput} onChange={e => setQtyInput(e.target.value)} type="number" className={formInput()} />
            </FormField>
            <FormField label="箱号" hint="> 0">
              <input value={boxInput} onChange={e => setBoxInput(e.target.value)} type="number" className={formInput()} />
            </FormField>
            <FormField label="包装类型">
              <select className={formSelect()} value={packTypeInput} onChange={e => setPackTypeInput(e.target.value)}>
                <option>自带包装</option>
                <option>仓库包装</option>
              </select>
            </FormField>
            <FormField label="箱库存类型">
              <select className={formSelect()} value={stockTypeInput} onChange={e => setStockTypeInput(e.target.value)}>
                <option>以仓库为准</option>
                <option>以箱为准</option>
              </select>
            </FormField>
            <div className="flex items-end gap-2">
              <Button size="sm" onClick={addLine}><Plus className="h-3.5 w-3.5" /> 增加</Button>
              <Button variant="secondary" size="sm" onClick={() => setLines([])}>清除</Button>
            </div>
          </div>

          <Card className="overflow-hidden">
            <Table>
              <thead className="table-head">
                <tr>
                  <th>箱序号</th>
                  <th>SKU</th>
                  <th>产品标题</th>
                  <th>数量</th>
                  <th>包装类型</th>
                  <th>库存类型</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody className="table-body">
                {lines.length === 0 ? (
                  <tr><td colSpan={7} className="table-cell py-8 text-center text-xs text-text-muted">暂无货品，请录入 SKU 后点击「增加」，或使用批量上传</td></tr>
                ) : lines.map(row => (
                  <tr key={row.id} className="table-row">
                    <td className="table-cell text-xs">{row.boxNo}</td>
                    <td className="table-cell"><MonoCode>{row.sku}</MonoCode></td>
                    <td className="table-cell text-xs">{row.name}</td>
                    <td className="table-cell text-xs font-semibold">{row.qty}</td>
                    <td className="table-cell text-xs">{row.packType}</td>
                    <td className="table-cell text-xs">{row.stockType}</td>
                    <td className="table-cell">
                      <button type="button" onClick={() => setLines(prev => prev.filter(l => l.id !== row.id))} className="text-red-500 hover:text-red-700">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          {lines.length > 0 && (
            <p className="mt-2 text-xs text-text-muted">
              合计 {lines.length} 行 · {lines.reduce((s, l) => s + l.qty, 0)} 件 · {new Set(lines.map(l => l.boxNo)).size} 箱
            </p>
          )}
        </FormSection>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border-light bg-white/95 px-6 py-4 backdrop-blur-sm lg:pl-[220px]">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3">
          <p className="hidden text-xs text-text-muted sm:block">
            {confirmWarehouseData
              ? '提交后进入「在途」，写入数据库 · 可在入库记录查看'
              : '提交前请勾选「以仓库收货数据为准」'}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={goRecords}>取消</Button>
            <Button variant="secondary" onClick={() => handleSubmit(true)}>保存草稿</Button>
            <Button onClick={() => handleSubmit(false)} disabled={!confirmWarehouseData}>提交</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
