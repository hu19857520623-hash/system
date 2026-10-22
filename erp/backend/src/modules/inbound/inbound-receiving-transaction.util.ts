import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import type { PrismaService } from '../../common/prisma/prisma.service'
import { loadPlatformBarcodesByInternalSku, productScanFields } from '../../common/platform-barcode-lookup.util'
import { findInboundItemByScan } from './inbound-item-scan.util'
import { matchCartonByScan } from '@erp/shared/wms-doc-no'
import { parseInboundQcScanInput } from './inbound-qc-scan.util'
import { inboundMeasurementVersion, inboundReceivingVersion } from './inbound-receiving-version.util'
import { inboundCartonReadiness } from './inbound-carton-readiness.util'
import { attachInboundWorkflowRevision, INBOUND_WAREHOUSE_ACTIONS } from './inbound-workflow-revision.util'
import type { MeasureInboundDto, RecordInboundCartonsDto, ScanInboundCartonDto, ScanInboundQcDto, SubmitInboundQcDto } from './dto/inbound-receiving.dto'

export type ReceivingOperation = 'carton-count' | 'carton-scan' | 'qc-scan' | 'qc-submit' | 'qc-measure-submit' | 'measure'
type ReceivingInput = RecordInboundCartonsDto | ScanInboundCartonDto | ScanInboundQcDto | SubmitInboundQcDto | MeasureInboundDto
const integer = (value: unknown, allowZero = false) => typeof value === 'number' && Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) && value <= 2147483647
const actionByKind = { 'carton-count': 'receive_carton_count', 'carton-scan': 'receive_carton', 'qc-scan': 'scan_qc', 'qc-submit': 'qc', 'qc-measure-submit': 'qc_measure', measure: 'measure_inbound' }
const labels: Record<string, string> = { pending_receipt: '在途', pending_push: '待推送', push_failed: '推送异常', pushed: '已推送', arrived: '已到仓', receiving: '收货中', pending_putaway: '待上架', exception: '异常', completed: '已入库', confirmed: '已入库', cancelled: '已作废', draft: '草稿' }
const pending = new Set(['pending_receipt', 'pending_push', 'push_failed', 'pushed'])
const terminal = new Set(['completed', 'confirmed', 'cancelled'])

export function normalizeReceivingInput(id: number, kind: ReceivingOperation, input: ReceivingInput) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input?.clientRequestId || '')) throw new BadRequestException('请提供有效的仓库操作标识，重新打开作业页面后重试')
  if (kind === 'carton-count') {
    const body = input as RecordInboundCartonsDto
    if (!integer(body.receivedCartonCount)) throw new BadRequestException('实收箱数须为大于零且未超出范围的整数')
    if (body.differenceReason != null && typeof body.differenceReason !== 'string') throw new BadRequestException('箱数差异原因须为文字内容')
    const differenceReason = String(body.differenceReason || '').trim()
    if (differenceReason.length > 500) throw new BadRequestException('箱数差异原因过长，请精简后重试')
    return { id, kind, receivedCartonCount: body.receivedCartonCount, differenceReason }
  }
  if (kind === 'measure') {
    const body = input as MeasureInboundDto
    if (!/^[a-f0-9]{64}$/.test(body.expectedVersion || '') || !Array.isArray(body.items) || !body.items.length) throw new BadRequestException('请重新读取最新测量进度，并填写有效明细')
    const ids = new Set<number>()
    const measureItems = body.items.map(line => {
      if (!Number.isSafeInteger(line.inboundItemId) || line.inboundItemId <= 0 || ids.has(line.inboundItemId)) throw new BadRequestException('测量明细编号无效或重复，请重新读取')
      ids.add(line.inboundItemId)
      let parsed: ReturnType<typeof parseInboundQcScanInput>
      try { parsed = parseInboundQcScanInput('MEASURE', 0, line) }
      catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '测量值无效') }
      if (parsed.lengthCm === undefined) throw new BadRequestException('请填写完整有效的长、宽、高')
      return { id: line.inboundItemId, lengthCm: parsed.lengthCm, widthCm: parsed.widthCm!, heightCm: parsed.heightCm!, weightKg: parsed.weightKg }
    }).sort((a, b) => a.id - b.id)
    return { id, kind, expectedVersion: body.expectedVersion, measureItems }
  }
  if (kind === 'qc-submit' || kind === 'qc-measure-submit') {
    const body = input as SubmitInboundQcDto
    if (!/^[a-f0-9]{64}$/.test(body.expectedVersion || '')) throw new BadRequestException('请重新读取最新清点进度后提交')
    if (body.acceptDiff != null && typeof body.acceptDiff !== 'boolean') throw new BadRequestException('是否接受数量差异须为有效选择')
    if (!Array.isArray(body.items) || !body.items.length) throw new BadRequestException('请提供完整清点明细')
    const ids = new Set<number>()
    const items = body.items.map(line => {
      if (!line || !Number.isSafeInteger(line.id) || line.id <= 0 || typeof line.sku !== 'string' || !line.sku.trim() || !integer(line.actualQty, true)) throw new BadRequestException('清点明细编号及实收数量须为有效整数，数量不能小于零')
      if (ids.has(line.id)) throw new BadRequestException('清点明细重复，请重新读取原单')
      ids.add(line.id)
      if (!['pass', 'fail'].includes(line.qcStatus)) throw new BadRequestException('请选择合格或异常质检结论')
      if (line.qcRemark != null && typeof line.qcRemark !== 'string') throw new BadRequestException('质检备注须为文字内容')
      const qcRemark = String(line.qcRemark || '').trim()
      if (qcRemark.length > 500) throw new BadRequestException('质检备注过长，请精简后重试')
      let dimensions: Partial<ReturnType<typeof parseInboundQcScanInput>> = {}
      if (kind === 'qc-measure-submit') {
        try { dimensions = parseInboundQcScanInput(line.sku, 0, line) }
        catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '测量值无效') }
        if (line.actualQty > 0 && dimensions.lengthCm === undefined) throw new BadRequestException(`${line.sku} 实收大于零，请提供完整有效的长、宽、高`)
      }
      return { id: line.id, sku: line.sku.trim(), actualQty: line.actualQty, qcStatus: line.qcStatus, qcRemark,
        ...(kind === 'qc-measure-submit' ? { lengthCm: dimensions.lengthCm, widthCm: dimensions.widthCm, heightCm: dimensions.heightCm, weightKg: dimensions.weightKg } : {}) }
    }).sort((a, b) => a.id - b.id)
    return { id, kind, expectedVersion: body.expectedVersion, acceptDiff: body.acceptDiff === true, items }
  }
  const body = input as ScanInboundQcDto
  if (typeof body.scanCode !== 'string' || !body.scanCode.trim()) throw new BadRequestException('请扫描有效的外箱标或 SKU')
  if (kind === 'carton-scan') return { id, kind, scanCode: body.scanCode.trim().toUpperCase() }
  try { return { id, kind, ...parseInboundQcScanInput(body.scanCode, body.increment, body) } }
  catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '扫描内容无效') }
}

function summary(order: any) {
  const totalExpected = order.items.reduce((sum: number, line: any) => sum + line.expectedQty, 0)
  const totalReceived = order.items.reduce((sum: number, line: any) => sum + (line.actualQty ?? 0), 0)
  return { id: Number(order.id), inboundNo: order.inboundNo, status: order.status, totalExpected, totalReceived, allReceived: totalReceived >= totalExpected,
    expectedCartonCount: order.cartons.length || null, scannedCartonCount: order.cartons.filter((box: any) => box.status === 'received').length, receivedCartonCount: order.receivedCartonCount ?? null }
}

async function beginIfArrived(tx: Prisma.TransactionClient, order: any, operatorId: number) {
  if (order.status !== 'arrived') return
  await tx.inboundOrder.update({ where: { id: order.id }, data: { status: 'receiving', receivedAt: new Date(), receivedBy: BigInt(operatorId) } })
  order.status = 'receiving'
  await tx.operationLog.create({ data: { operatorId: BigInt(operatorId), module: 'inbound', action: 'start_receive', targetType: 'inbound_order', targetId: order.inboundNo } })
}

/** All receipt state and its idempotency proof are committed together, before any subsequent read. */
export async function runInboundReceiving(prisma: PrismaService, id: number, kind: ReceivingOperation, input: ReceivingInput, operatorId?: number) {
  if (!operatorId || !Number.isSafeInteger(operatorId) || operatorId <= 0) throw new ForbiddenException('请重新登录后进行仓库作业')
  const request = normalizeReceivingInput(id, kind, input)
  const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex')
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM sys_user WHERE id = ${BigInt(operatorId)} FOR UPDATE`
    const previous = await tx.operationLog.findFirst({ where: { operatorId: BigInt(operatorId), module: 'inbound', action: { in: INBOUND_WAREHOUSE_ACTIONS }, detail: { path: '$.clientRequestId', equals: input.clientRequestId } } })
    if (previous) {
      const detail = previous.detail as any
      if (detail.requestFingerprint !== fingerprint) throw new ConflictException('本次仓库操作已用于其他内容，请先核对原操作，不要修改原请求后重试')
      return { ...detail.response, duplicate: true, increment: 0, message: '原仓库操作已处理，本次未重复执行，请按最新单据核对' }
    }
    await tx.$queryRaw`SELECT id FROM inbound_order WHERE id = ${BigInt(id)} FOR UPDATE`
    const order = await tx.inboundOrder.findUnique({ where: { id: BigInt(id) }, include: { items: true, cartons: { include: { items: true }, orderBy: { boxSeq: 'asc' } } } })
    if (!order) throw new NotFoundException('入库单不存在，请返回列表重新读取')
    await attachInboundWorkflowRevision(tx, order)
    if (terminal.has(order.status)) throw new BadRequestException('该入库单已完结')
    if (pending.has(order.status)) throw new BadRequestException('请先在「到仓扫描」确认到货，再登记箱数和清点')
    const measureOnly = (kind === 'qc-scan' || kind === 'measure') && order.status === 'pending_putaway'
    if (kind === 'measure' && !measureOnly) throw new BadRequestException(`当前状态「${labels[order.status] || '暂无法识别，请刷新核对'}」不可测量，请先完成清点`)
    if (!['arrived', 'receiving'].includes(order.status) && !measureOnly) {
      const verb = kind === 'carton-count' ? '登记实收箱数' : kind === 'carton-scan' ? '扫箱收货' : kind.startsWith('qc-') && kind !== 'qc-scan' ? '提交清点' : '扫描清点'
      throw new BadRequestException(`当前状态「${labels[order.status] || '暂无法识别，请刷新核对'}」不可${verb}`)
    }
    const warehouse = await tx.warehouse.findUnique({ where: { warehouseCode: order.warehouseCode } })
    if (!warehouse || warehouse.status !== 1 || warehouse.warehouseType !== 'wms') throw new BadRequestException('目的海外仓已停用或无效，请联系主管核对')
    if (!order.items.length) throw new BadRequestException('入库单没有商品明细，请联系主管核对后再作业')
    let response: any, action: string = actionByKind[kind]
    if (kind === 'carton-count') {
      const body = request as Extract<typeof request, { receivedCartonCount: number }>
      const scanned = order.cartons.filter(box => box.status === 'received').length
      const current = Math.max(scanned, order.receivedCartonCount || 0)
      if (body.receivedCartonCount < current) throw new BadRequestException(`实收箱数已确认 ${current} 箱，不能直接改小；请返回入库单管理使用减少箱数并填写原因`)
      if (order.cartons.length && body.receivedCartonCount !== order.cartons.length && body.differenceReason.length < 2) throw new BadRequestException(`实收 ${body.receivedCartonCount} 箱与应收 ${order.cartons.length} 箱不一致，请填写差异原因`)
      await beginIfArrived(tx, order, operatorId)
      await tx.inboundOrder.update({ where: { id: order.id }, data: { receivedCartonCount: body.receivedCartonCount } })
      order.receivedCartonCount = body.receivedCartonCount
      response = { message: `实收箱数已登记：${body.receivedCartonCount} 箱`, receivedCartonCount: body.receivedCartonCount, order: summary(order) }
    } else if (kind === 'carton-scan') {
      const body = request as Extract<typeof request, { scanCode: string }>
      const carton = matchCartonByScan(order.cartons, body.scanCode, order.inboundNo)
      if (!carton) throw new NotFoundException(`扫描码 ${body.scanCode} 未匹配本单外箱标；SKU 件数请在清点与测量环节确认`)
      const alreadyConfirmed = carton.status === 'received'
      if (!alreadyConfirmed) {
        await beginIfArrived(tx, order, operatorId)
        await tx.inboundCarton.update({ where: { id: carton.id }, data: { status: 'received', receivedAt: new Date(), receivedBy: BigInt(operatorId) } })
        carton.status = 'received'
        const count = Math.max(order.receivedCartonCount || 0, order.cartons.filter(box => box.status === 'received').length)
        await tx.inboundOrder.update({ where: { id: order.id }, data: { receivedCartonCount: count } }); order.receivedCartonCount = count
      } else action = 'receive_carton_check'
      response = { message: alreadyConfirmed ? `外箱 ${carton.boxCode} 已确认，本次未重复增加箱数` : `外箱 ${carton.boxCode} 已确认，实收 ${order.receivedCartonCount} 箱`, scanType: 'outer_box', increment: alreadyConfirmed ? 0 : 1,
        alreadyConfirmed, receivedCartonCount: order.receivedCartonCount, carton: { boxCode: carton.boxCode, items: carton.items.map(line => ({ sku: line.sku, qty: line.qty })) }, order: summary(order) }
    } else if (kind === 'qc-submit' || kind === 'qc-measure-submit') {
      const body = request as Extract<typeof request, { acceptDiff: boolean }>
      const readiness = await inboundCartonReadiness(tx, order)
      if (!readiness.ready) throw new BadRequestException(readiness.message)
      const productIds = [...new Set(order.items.map(line => line.productId))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
      if (kind === 'qc-measure-submit') for (const productId of productIds) await tx.$queryRaw`SELECT id FROM product WHERE id = ${productId} FOR UPDATE`
      const products = kind === 'qc-measure-submit' ? await tx.product.findMany({ where: { id: { in: productIds } } }) : []
      const version = kind === 'qc-measure-submit' ? inboundMeasurementVersion(order, products) : inboundReceivingVersion(order)
      if (version !== body.expectedVersion) throw new ConflictException('箱数、清点数量、商品测量或单据状态已变更，请重新读取最新进度后提交')
      if (body.items.length !== order.items.length) throw new BadRequestException('请逐条提交全部 SKU 清点明细，不能遗漏')
      const resolved = body.items.map(line => {
        const item = order.items.find(item => Number(item.id) === line.id && item.sku === line.sku)
        if (!item) throw new BadRequestException('清点明细编号与 SKU 不一致或不属于本单，请重新读取')
        return { line, item }
      })
      await beginIfArrived(tx, order, operatorId)
      for (const { line, item } of resolved) {
        await tx.inboundOrderItem.update({ where: { id: item.id }, data: { actualQty: line.actualQty, diffQty: line.actualQty - item.expectedQty, qcStatus: line.qcStatus, qcRemark: line.qcRemark || null } })
        Object.assign(item, { actualQty: line.actualQty, qcStatus: line.qcStatus, qcRemark: line.qcRemark })
        if (kind === 'qc-measure-submit' && line.actualQty > 0) {
          await tx.product.update({ where: { id: item.productId }, data: { measuredLengthCm: line.lengthCm, measuredWidthCm: line.widthCm, measuredHeightCm: line.heightCm, measuredAt: new Date(), ...(line.weightKg !== undefined ? { weightKg: line.weightKg } : {}) } })
          await tx.operationLog.create({ data: { operatorId: BigInt(operatorId), module: 'product', action: 'dimension_measure', targetType: 'product', targetId: item.sku, detail: { inboundNo: order.inboundNo, lengthCm: line.lengthCm, widthCm: line.widthCm, heightCm: line.heightCm } } })
        }
      }
      const abnormal = resolved.some(({ line, item }) => line.qcStatus === 'fail' || (line.actualQty !== item.expectedQty && !body.acceptDiff))
      const nextStatus = abnormal ? 'exception' : 'pending_putaway'
      await tx.inboundOrder.update({ where: { id: order.id }, data: { status: nextStatus, qcAt: new Date(), qcBy: BigInt(operatorId) } }); order.status = nextStatus
      response = { id, inboundNo: order.inboundNo, status: nextStatus, measuredCount: kind === 'qc-measure-submit' ? resolved.filter(({ line }) => line.actualQty > 0).length : 0,
        message: abnormal ? '清点已保存，存在质检或数量差异，请核对后处理异常' : kind === 'qc-measure-submit' ? '清点与测量已保存，请继续上架' : '清点已提交，请由测量与上架岗位继续', order: summary(order), items: order.items.map(line => ({ id: Number(line.id), sku: line.sku, expectedQty: line.expectedQty, actualQty: line.actualQty, putawayQty: line.putawayQty, qcStatus: line.qcStatus })) }
    } else if (kind === 'measure') {
      const body = request as Extract<typeof request, { measureItems: unknown }>
      const resolved = body.measureItems.map(line => {
        const item = order.items.find(item => Number(item.id) === line.id)
        if (!item || !(item.actualQty && item.actualQty > 0)) throw new BadRequestException('测量明细须属于本单且已有正实收数量')
        return { line, item }
      })
      const productIds = [...new Set(resolved.map(({ item }) => item.productId))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
      for (const productId of productIds) await tx.$queryRaw`SELECT id FROM product WHERE id = ${productId} FOR UPDATE`
      const products = await tx.product.findMany({ where: { id: { in: order.items.map(item => item.productId) } } })
      if (inboundMeasurementVersion(order, products) !== body.expectedVersion) throw new ConflictException('实收数量或商品测量已变更，请重新读取最新进度后提交')
      for (const { line, item } of resolved) {
        await tx.product.update({ where: { id: item.productId }, data: { measuredLengthCm: line.lengthCm, measuredWidthCm: line.widthCm, measuredHeightCm: line.heightCm, measuredAt: new Date(), ...(line.weightKg !== undefined ? { weightKg: line.weightKg } : {}) } })
        await tx.operationLog.create({ data: { operatorId: BigInt(operatorId), module: 'product', action: 'dimension_measure', targetType: 'product', targetId: item.sku, detail: { inboundNo: order.inboundNo, lengthCm: line.lengthCm, widthCm: line.widthCm, heightCm: line.heightCm } } })
      }
      response = { id, inboundNo: order.inboundNo, status: order.status, measuredCount: resolved.length, message: '测量已保存，请继续上架', order: summary(order) }
    } else {
      const body = request as Extract<typeof request, { skuToken: string }>
      if (body.increment > 0 && measureOnly) throw new BadRequestException('该入库单已提交清点，不能再累加实收；请进入测量与上架')
      if (body.increment > 0) {
        const readiness = await inboundCartonReadiness(tx, order)
        if (!readiness.ready) throw new BadRequestException(readiness.message)
      }
      const ids = [...new Set(order.items.map(line => line.productId))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
      for (const productId of ids) await tx.$queryRaw`SELECT id FROM product WHERE id = ${productId} FOR UPDATE`
      const products = await tx.product.findMany({ where: { id: { in: ids } } }), byId = new Map(products.map(product => [Number(product.id), product]))
      const codes = order.items.flatMap(line => { const product = byId.get(Number(line.productId)); return [line.sku, product?.sku, product?.customerSku].filter(Boolean) as string[] })
      const aliases = await loadPlatformBarcodesByInternalSku(tx, codes), barcodes = new Map<number, string[]>()
      for (const line of order.items) {
        const product = byId.get(Number(line.productId))
        // A bare customer SKU can exist for several customers. Only a binding to
        // this complete warehouse SKU is sufficient proof for an automatic increment.
        const fullKeys = new Set([line.sku, product?.sku].filter(Boolean).map(code => code!.toUpperCase()))
        const scopedAliases = new Map([...aliases].filter(([key]) => fullKeys.has(key)))
        const scan = productScanFields(line.sku, product, scopedAliases)
        barcodes.set(Number(line.productId), [line.sku, product?.sku || '', scan.barcode, scan.platformBarcode, ...scan.platformBarcodes].filter(Boolean))
      }
      const matches = order.items.filter(line => !!findInboundItemByScan([line], body.skuToken, barcodes))
      if (matches.length > 1) throw new BadRequestException('扫描码对应本单多条明细，请按明细编号人工核对清点，不能自动累加到任意一条')
      const item = matches[0]
      if (!item) throw new NotFoundException(`扫描码 ${body.skuToken} 不属于入库单 ${order.inboundNo}`)
      const current = item.actualQty || 0, next = current + body.increment
      if (!integer(next, true)) throw new BadRequestException('累计清点数量超出支持范围，请核对后重试')
      const hasDimensions = body.lengthCm !== undefined
      if (!body.increment && !hasDimensions && body.weightKg === undefined) throw new BadRequestException('请填写完整长宽高或有效重量后确认测量')
      if (body.increment > 0) {
        await beginIfArrived(tx, order, operatorId)
        await tx.inboundOrderItem.update({ where: { id: item.id }, data: { actualQty: next, diffQty: next - item.expectedQty } }); item.actualQty = next
      }
      if (hasDimensions || body.weightKg !== undefined) await tx.product.update({ where: { id: item.productId }, data: {
        ...(hasDimensions ? { measuredLengthCm: body.lengthCm, measuredWidthCm: body.widthCm, measuredHeightCm: body.heightCm, measuredAt: new Date() } : {}), ...(body.weightKg !== undefined ? { weightKg: body.weightKg } : {}) } })
      response = { message: body.increment ? `清点 ${item.sku} 增加 ${body.increment} 件，累计 ${next}/${item.expectedQty}` : `测量 ${item.sku} 已保存`, sku: item.sku, increment: body.increment,
        itemId: Number(item.id), expectedQty: item.expectedQty, actualQty: next, remaining: Math.max(0, item.expectedQty - next), order: summary(order) }
    }
    await tx.operationLog.create({ data: { operatorId: BigInt(operatorId), module: 'inbound', action, targetType: 'inbound_order', targetId: order.inboundNo,
      detail: JSON.parse(JSON.stringify({ clientRequestId: input.clientRequestId, requestFingerprint: fingerprint, request, response })) } })
    return { ...response, duplicate: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 })
}
