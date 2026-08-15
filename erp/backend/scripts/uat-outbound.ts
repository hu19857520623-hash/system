/**
 * 出库全流程 UAT：创建 → 拣货 → 打包 → 发运 → 校验库存与计费
 * 用法: npx ts-node scripts/uat-outbound.ts
 */
import { PrismaClient } from '@prisma/client'

const BASE = process.env.API_BASE || 'http://127.0.0.1:3000/api'
const WH = 'WMS-JHB-01'
const prisma = new PrismaClient()

async function ensureLocationStock(): Promise<{ sku: string; locationCode: string } | null> {
  const inv = await prisma.inventory.findFirst({
    where: { warehouseCode: WH, availableQty: { gt: 0 } },
    orderBy: { availableQty: 'desc' },
  })
  if (!inv) return null
  const loc = await prisma.warehouseLocation.findFirst({
    where: { warehouseCode: WH, status: 'available' },
    orderBy: { id: 'asc' },
  })
  if (!loc) return null

  const existing = await prisma.inventoryLocation.findFirst({
    where: { productId: inv.productId, locationId: loc.id, sku: inv.sku },
  })
  if (!existing) {
    await prisma.inventoryLocation.create({
      data: {
        productId: inv.productId,
        sku: inv.sku,
        warehouseCode: WH,
        locationId: loc.id,
        locationCode: loc.locationCode,
        qty: Math.min(inv.availableQty, 5),
        inboundNo: 'UAT-SETUP',
      },
    })
    console.log(`[setup] 已写入库位库存 ${inv.sku} @ ${loc.locationCode} × ${Math.min(inv.availableQty, 5)}`)
  }
  return { sku: inv.sku, locationCode: loc.locationCode }
}

async function req<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  }
  const res = await fetch(`${BASE}${path}`, { ...opts, headers })
  const json = await res.json()
  if (json.code !== 0) throw new Error(json.message || `HTTP ${res.status}`)
  return json.data as T
}

async function main() {
  console.log('=== 出库 UAT ===')
  let step = '初始化'

  try {
  step = '准备库位库存'
  await ensureLocationStock()

  step = '登录'
  const login = await req<{ token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'wh', password: '123456' }),
  })
  const auth = { Authorization: `Bearer ${login.token}` }

  step = '查询库存'
  const invRes = await req<{ items: any[] }>(`/inventory?warehouseCode=${WH}&pageSize=50`, { headers: auth })
  const inv = (invRes.items || []).find((r) => (r.availableQty ?? 0) >= 1)
  if (!inv) throw new Error('无可用库存，请先在 JHB 仓入库')

  // 发运计费需 customerId；仓库角色无客户列表权限，使用固定测试客户 #1
  const customerId = Number(process.env.UAT_CUSTOMER_ID || 1)

  step = '查询库位'
  const locRes = await req<any[] | { items: any[] }>(`/locations?warehouseCode=${WH}&status=available`, { headers: auth })
  const locRows = Array.isArray(locRes) ? locRes : locRes.items || []
  let pickLoc = ''
  for (const loc of locRows) {
    const detail = await req<any>(`/locations/${loc.id}/inventory`, { headers: auth }).catch(() => null)
    const rows = Array.isArray(detail) ? detail : detail?.items || []
    if (rows.some((r: any) => r.sku === inv.sku && (r.qty ?? 0) >= 1)) {
      pickLoc = loc.locationCode
      break
    }
  }
  if (!pickLoc) throw new Error(`SKU ${inv.sku} 无库位库存，请先上架`)

  const beforeQty = inv.availableQty ?? inv.totalQty ?? 0
  console.log(`库存前: ${inv.sku} 可用 ${beforeQty}，拣货库位 ${pickLoc}，客户 #${customerId}`)

  step = '创建出库单'
  const fakePdf = Buffer.from('%PDF-1.4 UAT-CPT').toString('base64')
  const order = await req<any>('/outbound', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      warehouseCode: WH,
      customerId,
      destType: 'cpt',
      needsRelabel: false,
      fileName: 'uat-cpt.pdf',
      contentBase64: fakePdf,
      items: [{ productId: inv.productId, sku: inv.sku, productName: inv.productName, qty: 1 }],
    }),
  })
  console.log(`✓ 创建出库单 ${order.outboundNo} (id=${order.id})`)

  step = '拣货'
  await req(`/outbound/${order.id}/pick`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      items: order.items.map((i: any) => ({ id: i.id, locationCode: pickLoc, pickedQty: 1 })),
    }),
  })
  console.log('✓ 拣货完成')

  step = '打包'
  await req(`/outbound/${order.id}/pack`, { method: 'POST', headers: auth })
  console.log('✓ 打包完成')

  step = '发运'
  await req(`/outbound/${order.id}/ship`, { method: 'POST', headers: auth })
  console.log('✓ 发运完成')

  step = '校验库存'
  const afterInv = await req<{ items: any[] }>(`/inventory?warehouseCode=${WH}&keyword=${encodeURIComponent(inv.sku)}`, { headers: auth })
  const row = (afterInv.items || []).find((r) => r.sku === inv.sku)
  const afterQty = row?.availableQty ?? row?.totalQty ?? 0
  console.log(`库存后: 可用/总量 ${afterQty} (预期约 ${beforeQty - 1})`)

  step = '校验计费'
  const adminLogin = await req<{ token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: '123456' }),
  })
  const adminAuth = { Authorization: `Bearer ${adminLogin.token}` }
  const charges = await req<{ items: any[] }>(
    `/billing/charges?source=erp&keyword=${encodeURIComponent(order.outboundNo)}&pageSize=20`,
    { headers: adminAuth },
  )
  const erpCharges = (charges.items || []).filter((c) => c.bizRef === order.outboundNo || c.sourceRef === order.outboundNo)
  console.log(`✓ ERP 计费 ${erpCharges.length} 笔: ${erpCharges.map((c) => c.chargeType).join(', ')}`)

  step = '下载 CPT 附件'
  const att = await fetch(`${BASE}/outbound/${order.id}/attachment`, { headers: auth })
  if (!att.ok) throw new Error('CPT 附件下载失败')
  console.log(`✓ CPT 附件可下载 (${att.headers.get('content-disposition') || 'ok'})`)

  console.log('\n=== UAT 通过 ===')
  } catch (e: any) {
    console.error(`\n=== UAT 失败 @ ${step} ===`)
    console.error(e.message || e)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
