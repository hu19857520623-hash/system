/**
 * 后端字段 → 前端展示字段映射
 */

import { CATALOG_CUSTOMER_CODE, catalogBaseSkuFromInternal } from '@/constants/catalog.ts'
import { catalogRoleName, roleSide, type RoleSide } from '@erp/shared/permissions.catalog'

function parseFollowSalesFromRemark(remark?: string | null): string {
  const text = String(remark || '')
  const again = text.match(/再对接:([^|]+)/)
  if (again?.[1]?.trim()) return again[1].trim()
  const first = text.match(/(?<!再)对接:([^|]+)/)
  if (first?.[1]?.trim()) return first[1].trim()
  return ''
}

function parseLeadAcqFromRemark(remark?: string | null): string {
  const matched = String(remark || '').match(/获客:([^|]+)/)
  return matched?.[1]?.trim() || ''
}

/** 去掉 remark 开头的导入元数据（留资/获客/对接等），与后端 leads-remark.util 保持一致。 */
export function stripLeadRemarkImportPrefix(remark?: string | null): string {
  let text = String(remark || '').trim()
  if (!text) return ''
  text = text.replace(/^(?:(?:\s*(?:留资|前端|获客|对接|再对接|销售情况):[^|]*)\s*(?:\|\s*)?)+/u, '').trim()
  text = text.replace(/^备注:\s*/u, '').trim()
  return text
}

export function looksLikeLeadPhone(raw?: string | null): boolean {
  const digits = String(raw || '').replace(/[\s\-()+]/g, '')
  return /^1[3-9]\d{9}$/.test(digits) || /^0\d{10,11}$/.test(digits) || /^\+?27\d{8,10}$/.test(digits)
}

/** 线索池把姓名 / 微信 / 电话合成一列展示，避免和客户名称重复。 */
export function formatLeadContact(row: {
  contactName?: string | null
  contactPhone?: string | null
  companyName?: string | null
  company?: string | null
}): string {
  const company = String(row.companyName || row.company || '').trim()
  const uniq: string[] = []
  for (const raw of [row.contactName, row.contactPhone]) {
    const value = String(raw || '').trim()
    if (!value || uniq.includes(value)) continue
    uniq.push(value)
  }
  if (uniq.length > 1) {
    const withoutCompany = uniq.filter((value) => value !== company)
    if (withoutCompany.length) return withoutCompany.join(' / ')
  }
  return uniq.join(' / ')
}

export function fmtTime(d: string | Date | null | undefined): string {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d) : d
  return dt.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d) : d
  return dt.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function num(v: unknown, fallback = 0): number {
  if (v == null || v === '') return fallback
  return Number(v)
}

export function mapProduct(row: any) {
  const sync = row.syncStatus === 'synced' ? 'OMS✓ ERP✓' : row.syncStatus === 'partial' ? '部分同步' : '未同步'
  const statusMap: Record<string, string> = { active: '已生效', pending: '待完善主数据', inactive: '已停用' }
  const images = row.images || []
  const imageUrls = images.length
    ? images.map((img: { imageUrl: string }) => img.imageUrl)
    : row.imageUrl
      ? [row.imageUrl]
      : row.imageUrls || []
  const purchaseCost = row.purchaseCostRmb ?? row.costRmb ?? 0
  const seaFreight = row.seaFreightPerUnit ?? 0
  const domesticFee = row.domesticFeePerUnit ?? 0
  const totalCost = row.totalCostRmb ?? (Number(purchaseCost) + Number(seaFreight) + Number(domesticFee))
  return {
    id: row.id,
    sku: row.sku,
    spu: row.spu || '',
    name: row.productName,
    spec: row.spec || '',
    length: String(row.lengthCm ?? ''),
    width: String(row.widthCm ?? ''),
    height: String(row.heightCm ?? ''),
    weight: String(row.weightKg ?? ''),
    cost: String(totalCost || row.costRmb || ''),
    purchaseCost: String(purchaseCost ?? ''),
    seaFreight: String(seaFreight ?? ''),
    domesticFee: String(domesticFee ?? ''),
    totalCost: String(totalCost ?? ''),
    barcode: row.barcode || '',
    imageUrl: imageUrls[0] || '',
    imageUrls,
    images,
    imageCount: imageUrls.length,
    developer: row.developerName || '—',
    developerId: row.developerId ?? null,
    purchaser: row.purchaserName || '—',
    purchaserId: row.purchaserId ?? null,
    supplier: row.supplierName || '—',
    supplierId: row.supplierId ?? null,
    status: statusMap[row.status] || row.status,
    statusKey: row.status,
    sync,
    history: row.history || [],
    tone: row.status === 'active' ? 'ok' : row.status === 'inactive' ? 'danger' : 'neutral',
    _raw: row,
  }
}

export function mapProductDev(row: any) {
  const statusMap: Record<string, string> = {
    draft: '草稿',
    submitted: '待审核',
    approved: '已通过',
    rejected: '已驳回',
  }
  return {
    id: row.id,
    applyNo: row.applyNo,
    sku: row.sku || '',
    name: row.productName,
    spec: row.spec || '',
    cost: num(row.estimatedCost),
    marketPrice: num(row.marketPrice),
    sellPriceRmb: num(row.sellPriceRmb),
    maxSellPriceRmb: num(row.maxSellPriceRmb),
    reason: row.reason || '',
    link: row.takealotUrl || '#',
    takealotPriceImageUrl: row.takealotPriceImageUrl || '',
    amazonUrl: row.amazonUrl || '',
    alibaba1688Url: row.alibaba1688Url || '',
    alibaba1688ImageUrl: row.alibaba1688ImageUrl || '',
    productLengthCm: num(row.productLengthCm),
    productWidthCm: num(row.productWidthCm),
    productHeightCm: num(row.productHeightCm),
    packageLengthCm: num(row.packageLengthCm),
    packageWidthCm: num(row.packageWidthCm),
    packageHeightCm: num(row.packageHeightCm),
    seaFreightChannel: row.seaFreightChannel || '',
    volumetricWeightKg: num(row.volumetricWeightKg),
    cbm: num(row.cbm),
    status: statusMap[row.status] || row.status,
    statusKey: row.status,
    purchaseQty: row.purchaseQty,
    time: fmtTime(row.createdAt),
    _raw: row,
  }
}

export function mapProductAudit(row: any) {
  const statusMap: Record<string, string> = {
    submitted: '待审核',
    approved: '已通过',
    rejected: '已驳回',
  }
  const base = mapProductDev(row)
  return {
    ...base,
    id: row.id,
    applyNo: row.applyNo,
    name: row.productName,
    sku: row.sku || '—',
    purchaseQty: row.purchaseQty,
    auditRemark: row.auditRemark || '',
    status: statusMap[row.status] || row.status,
    statusKey: row.status,
    user: row.applicantName || '—',
    time: fmtTime(row.createdAt),
    _raw: row,
  }
}

export function mapPrePurchaseOrder(row: any) {
  return {
    id: row.id,
    prePoNo: row.prePoNo,
    devId: row.devId,
    applyNo: row.applyNo,
    sku: row.sku,
    productName: row.productName,
    spec: row.spec || '',
    plannedQty: row.plannedQty ?? 0,
    unitPrice: row.unitPrice != null ? num(row.unitPrice) : null,
    supplierId: row.supplierId,
    supplier: row.supplierName || '—',
    domesticFreight: row.domesticFreight,
    warehouseCode: row.warehouseCode || '',
    currency: row.currency || 'RMB',
    expectedArrivalStr: row.expectedArrivalStr || '',
    purchaser: row.purchaserName || '—',
    purchaserId: row.purchaserId,
    status: row.status,
    statusKey: row.status,
    cancelReason: row.cancelReason || '',
    remark: row.remark || '',
    convertedPoId: row.convertedPoId,
    createdAtStr: row.createdAtStr || '',
    _raw: row,
  }
}

export function mapPendingSkuAssign(row: any) {
  return {
    devId: row.devId,
    applyNo: row.applyNo,
    sku: row.sku || '',
    productName: row.productName,
    spec: row.spec || '',
    requiredQty: row.requiredQty ?? 0,
    unitPrice: num(row.unitPrice),
    marketPrice: row.marketPrice != null ? num(row.marketPrice) : null,
    developer: row.developerName || '—',
    auditedAtStr: row.auditedAtStr || fmtTime(row.auditedAt),
    takealotUrl: row.takealotUrl || '',
    auditRemark: row.auditRemark || '',
    _raw: row,
  }
}

export function mapPendingMasterData(row: any) {
  const dims = [row.lengthCm, row.widthCm, row.heightCm].filter((v) => v != null && v > 0)
  return {
    productId: row.productId,
    devId: row.devId,
    applyNo: row.applyNo || '',
    sku: row.sku,
    productName: row.productName,
    spec: row.spec || '',
    costRmb: row.costRmb,
    referenceCost: row.referenceCost,
    dimensions: dims.length === 3 ? `${dims[0]}×${dims[1]}×${dims[2]} cm` : '—',
    weightKg: row.weightKg,
    barcode: row.barcode || '',
    supplier: row.supplierName || '—',
    supplierId: row.supplierId,
    developer: row.developerName || '—',
    purchaser: row.purchaserName || '—',
    requiredQty: row.requiredQty ?? 0,
    auditedAtStr: row.auditedAtStr || '',
    _raw: row,
  }
}

export function mapPendingPurchaseSku(row: any) {
  return {
    devId: row.devId,
    applyNo: row.applyNo,
    sku: row.sku,
    productId: row.productId,
    productName: row.productName,
    spec: row.spec || '',
    requiredQty: row.requiredQty ?? 0,
    orderedQty: row.orderedQty ?? 0,
    pendingQty: row.pendingQty ?? 0,
    unitPrice: num(row.unitPrice),
    marketPrice: row.marketPrice != null ? num(row.marketPrice) : null,
    developer: row.developerName || '—',
    purchaser: row.purchaserName || '—',
    auditedAtStr: row.auditedAtStr || fmtTime(row.auditedAt),
    takealotUrl: row.takealotUrl || '',
    auditRemark: row.auditRemark || '',
    _raw: row,
  }
}

export function mapPurchaseOrder(row: any) {
  const statusMap: Record<string, string> = {
    draft: '草稿',
    pending_po_audit: '待主管审核',
    pending_actual_qty: '待核定实际数量',
    approved: '已批准',
    finance_approved: '待中转仓收货',
    at_logistics_wh: '中转仓部分收货',
    received: '中转仓已收齐',
    rejected: '已驳回',
    completed: '已完成',
  }
  return {
    id: row.id,
    poNo: row.poNo,
    supplier: row.supplierName || '—',
    supplierId: row.supplierId,
    warehouseCode: row.warehouseCode || '',
    warehouseName: row.warehouseName || row.warehouseCode || '—',
    currency: row.currency || 'RMB',
    amount: num(row.totalAmount),
    domesticFreight: row.domesticFreight != null ? num(row.domesticFreight) : null,
    status: statusMap[row.status] || row.status,
    statusKey: row.status,
    items: row.items || [],
    remark: row.remark || '',
    purchaserName: row.purchaserName || '—',
    auditorName: row.auditorName || '—',
    auditedAtStr: row.auditedAtStr || '',
    poAuditRemark: row.poAuditRemark || '',
    financeName: row.financeName || '—',
    financeAtStr: row.financeAtStr || '',
    financeRemark: row.financeRemark || '',
    paymentStatus: row.paymentStatus === 'paid' ? 'paid' : 'unpaid',
    paymentStatusLabel: row.paymentStatus === 'paid' ? '已打款' : '未打款',
    paidAtStr: row.paidAtStr || '',
    paidByName: row.paidByName || '—',
    expectedArrivalStr: row.expectedArrivalStr || fmtDate(row.expectedArrival),
    createdAtStr: row.createdAtStr || fmtTime(row.createdAt),
    purchaseConfirmation: row.purchaseConfirmation || null,
    time: fmtTime(row.createdAt),
    _raw: row,
  }
}

export function mapSupplier(row: any) {
  return {
    id: row.id,
    code: row.supplierCode,
    name: row.supplierName,
    contact: row.contactName || '',
    phone: row.contactPhone || '',
    city: row.city || '',
    settle: row.paymentTerms || '现结',
    term: row.leadTimeDays ? `${row.leadTimeDays} 天` : '—',
    openPo: row.openPoCount ?? '—',
    rating: row.rating ?? 3,
    status: row.status === 1 ? '合作中' : '已停用',
    _raw: row,
  }
}

export function mapLead(row: any) {
  const statusMap: Record<string, string> = {
    new: '新线索',
    following: '跟进中',
    recall: '需要再次跟进',
    hot: '意向高',
    nurture: '暂无意向',
    deal: '已成交',
    lost: '已流失',
  }
  const latestFollow = Array.isArray(row.followUps) ? row.followUps[0] : null
  const latestFollowContent = String(latestFollow?.content || '').trim()
  const nextPlan = String(latestFollow?.nextPlan || '').trim()
  return {
    id: row.id,
    leadNo: row.leadNo,
    company: row.companyName,
    contact: formatLeadContact(row),
    phone: row.contactPhone || row.phone || '',
    source: row.source || '',
    acq: parseLeadAcqFromRemark(row.remark),
    status: statusMap[row.status] || row.status,
    statusKey: row.status,
    owner: row.assigneeName || row.ownerName || '—',
    assigneeId: row.assigneeId != null ? Number(row.assigneeId) : null,
    followSales: String(row.followSales || '').trim() || parseFollowSalesFromRemark(row.remark),
    time: fmtTime(row.createdAt),
    latestFollowContent,
    latestFollowAt: latestFollow?.createdAt ? fmtTime(latestFollow.createdAt) : '',
    nextPlan,
    nextFollowAt: latestFollow?.nextFollowAt ? fmtTime(latestFollow.nextFollowAt) : '',
    situation: latestFollowContent || '暂无跟进',
    _raw: row,
  }
}

export function mapInventory(row: any) {
  return {
    sku: row.sku,
    name: row.productName || row.name || '',
    spec: row.spec || '',
    warehouse: row.warehouseCode,
    warehouseName: row.warehouseName || row.warehouseCode,
    available: row.availableQty ?? 0,
    locked: row.lockedQty ?? 0,
    total: row.totalQty ?? 0,
    inTransit: row.inTransitQty ?? 0,
    lastInboundDate: row.lastInboundDate || '',
    referenceNo: row.referenceNo || '',
    _raw: row,
  }
}

export function mapInbound(row: any) {
  return {
    id: row.id,
    inboundNo: row.inboundNo,
    warehouse: row.warehouseCode,
    sourceWarehouse: row.sourceWarehouseCode || '',
    status: row.status,
    qty: row.totalQty ?? 0,
    time: fmtTime(row.createdAt),
    _raw: row,
  }
}

export function mapCustomer(row: any) {
  const oms = row.oms || null
  const dataSource =
    row.dataSource === 'oms' || row.dataSource === 'both' || row.dataSource === 'erp'
      ? row.dataSource
      : oms
        ? (row.readOnly || Number(row.id) < 0 ? 'oms' : 'both')
        : 'erp'
  const dataSourceLabel =
    dataSource === 'both' ? 'ERP+OMS' : dataSource === 'oms' ? 'OMS' : 'ERP'
  const typeLabels: Record<string, string> = {
    ecommerce: '电商',
    catalog: '货盘',
    hybrid: '混合',
  }
  const portalUsername = oms?.portalUsername || oms?.portalLoginEmail || ''
  const portalReady = Boolean(oms?.portalReady || portalUsername)
  const portalStatus = oms?.portalStatus || (portalReady ? oms?.omsStatus : '') || ''
  const portalMustChangePassword = oms?.mustChangePassword === true
  const omsLastLogin = oms?.lastLoginAt ? fmtTime(oms.lastLoginAt) : ''
  const portalActivationLabel = !oms ? '未开通' : portalReady ? '已开通' : '待激活'
  const portalLoginStatusLabel = !oms
    ? '无门户账户'
    : !portalReady
      ? '待设置临时密码'
      : portalStatus === 'disabled'
        ? '登录已停用'
        : omsLastLogin
          ? '已登录'
          : portalMustChangePassword
            ? '待首次登录 · 首登改密'
            : '尚未登录'
  return {
    id: row.id,
    code: row.customerCode,
    company: row.customerName || row.companyName || '',
    companyName: row.companyName || '',
    email: row.contactEmail || '',
    contact: row.contactName || '',
    phone: row.contactPhone || '',
    balance: num(row.balance),
    totalRecharge: num(row.totalRecharge),
    lastRechargeAt: fmtTime(row.lastRechargeAt),
    createdAt: fmtTime(row.createdAt),
    updatedAt: fmtTime(row.updatedAt),
    status: row.status === 1 ? '正常' : '停用',
    statusCode: row.status ?? 1,
    dataSource,
    dataSourceLabel,
    readOnly: row.readOnly ?? false,
    hasOmsAccount: Boolean(oms),
    omsType: oms?.type || '',
    omsTypeLabel: oms?.type ? (typeLabels[oms.type] || oms.type) : '',
    omsWarehouse: oms?.warehouse || '',
    omsStatus: oms?.omsStatus || '',
    omsLastLogin,
    omsCreditBalance: oms?.creditBalance != null ? num(oms.creditBalance) : null,
    omsMonthlySpent: oms?.monthlySpent != null ? num(oms.monthlySpent) : null,
    omsPendingBill: oms?.pendingBill != null ? num(oms.pendingBill) : null,
    omsPermissions: oms?.permissions || [],
    portalReady,
    portalUsername,
    portalLoginEmail: portalUsername,
    portalStatus,
    portalMustChangePassword,
    portalActivationLabel,
    portalLoginStatusLabel,
    portalStateLabel: !oms
      ? '未开通'
      : portalReady
        ? (portalStatus === 'active' ? '可登录' : '已停用')
        : '待设置密码',
    _raw: row,
  }
}

export function mapSyncLog(row: any) {
  return {
    id: row.id,
    type: row.syncType,
    target: row.targetSystem,
    ref: row.refNo || '',
    status: row.status,
    message: row.errorMsg || row.message || '',
    time: fmtTime(row.createdAt),
    _raw: row,
  }
}

export function mapCostLedger(row: any) {
  return {
    id: row.id,
    sku: row.sku || '—',
    type: row.costType,
    amount: num(row.amount),
    currency: row.currency || 'RMB',
    ref: row.refNo || '',
    time: fmtTime(row.createdAt),
    _raw: row,
  }
}

export function mapUser(row: any) {
  const roleLabel = row.roleName || catalogRoleName(row.roleCode)
  const side: RoleSide =
    row.roleSide === 'office' || row.roleSide === 'warehouse' || row.roleSide === 'system'
      ? row.roleSide
      : roleSide(row.roleCode)
  return {
    id: row.id,
    login: row.username,
    name: row.realName,
    role: roleLabel,
    roleCode: row.roleCode,
    roleName: roleLabel,
    roleSide: side,
    phone: row.phone || '',
    email: row.email || '',
    workstation: row.workstation || '',
    status: row.status === 1 ? 'ok' : 'disabled',
    statusCode: row.status ?? 1,
    lastLogin: fmtTime(row.lastLoginAt) || '—',
    _raw: row,
  }
}

export function mapWarehouse(row: any) {
  const code = row.warehouseCode
  const rawName = row.warehouseName || ''
  const name =
    code === 'WMS-JHB-01' || String(rawName).includes('JHB')
      ? 'JHB'
      : rawName
  return {
    id: row.id,
    code,
    warehouseCode: code,
    name,
    warehouseName: name,
    type: row.warehouseType === 'logistics' ? '物流仓' : '海外仓',
    typeKey: row.warehouseType || 'logistics',
    city: row.city || '',
    country: row.country || '',
    address: row.address || '',
    contactName: row.contactName || '',
    contactPhone: row.contactPhone || '',
    requiredOutboundFiles: Array.isArray(row.requiredOutboundFiles) ? row.requiredOutboundFiles : [],
    totalVolumeCbm: row.totalVolumeCbm != null && row.totalVolumeCbm !== '' ? Number(row.totalVolumeCbm) : null,
    status: row.status === 1 ? '启用' : '停用',
    statusCode: row.status ?? 1,
    _raw: row,
  }
}

export function mapLogisticsReceipt(row: any) {
  const items = row.items || []
  return {
    id: row.id,
    receiptNo: row.receiptNo,
    poNo: row.poNo,
    warehouseCode: row.warehouseCode,
    operatorName: row.operatorName || '—',
    receivedAt: row.receivedAt,
    remark: row.remark || '',
    items,
    skuCount: items.length,
    totalQty: items.reduce((s: number, i: any) => s + (i.actualQty || 0), 0),
    damagedQty: items.reduce((s: number, i: any) => s + (i.damagedQty || 0), 0),
    hasQcIssue: items.some((i: any) => (i.damagedQty || 0) > 0 || i.qcStatus === 'fail'),
    _raw: row,
  }
}

export function mapPricing(row: any) {
  const sku = row.sku || ''
  const customerCode = row.customerCode || CATALOG_CUSTOMER_CODE
  const customerSku = row.customerSku || catalogBaseSkuFromInternal(sku)
  return {
    id: row.id,
    sku,
    customerCode,
    customerSku,
    name: row.name || row.productName,
    spec: row.spec || '',
    cost: num(row.cost ?? row.costRmb),
    purchaseQty: row.purchaseQty ?? 0,
    inboundQty: row.inboundQty ?? 0,
    visibleStockQty: row.visibleStockQty != null ? Number(row.visibleStockQty) : null,
    soldQty: row.soldQty ?? 0,
    remainingStockQty: row.remainingStockQty ?? 0,
    catalogStockPool: row.catalogStockPool ?? 0,
    warehouseAvailableQty: row.warehouseAvailableQty ?? 0,
    poNo: row.poNo || '',
    inboundNo: row.inboundNo || '',
    seaFreight: num(row.seaFreight),
    domesticFee: num(row.domesticFee),
    exchangeRate: num(row.exchangeRate, 2.5),
    freightCallbackTime: row.freightCallbackTime || fmtTime(row.freightCallbackAt),
    marketPrice: num(row.marketPrice),
    pricingLogic: row.pricingLogic || '',
    targetProfitRate: num(row.targetProfitRate),
    finalPrice: num(row.finalPrice),
    overseasDeliveryFee: num(row.overseasDeliveryFee),
    platformCommission: num(row.platformCommission),
    platformDeliveryFee: num(row.platformDeliveryFee),
    pricingStatus: row.pricingStatus,
    omsSyncTime: row.omsSyncTime || fmtTime(row.omsSyncAt),
    visibleOnOms: Boolean(row.visibleOnOms),
    orderableOnOms: Boolean(row.orderableOnOms),
    visibleOnOmsAt: row.visibleOnOmsAt || fmtTime(row.visibleOnOmsAt),
    orderableOnOmsAt: row.orderableOnOmsAt || fmtTime(row.orderableOnOmsAt),
    history: row.history || [],
    priceRecords: row.priceRecords || [],
    holderCount: row.holderCount ?? 0,
    holderSummary: row.holderSummary || '',
    holders: row.holders || [],
    _raw: row,
  }
}
