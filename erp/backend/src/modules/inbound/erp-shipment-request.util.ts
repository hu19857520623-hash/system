import { BadRequestException } from '@nestjs/common'
import { createHash } from 'crypto'
import type { CreateErpShipmentDto } from './dto/erp-shipment.dto'

const dimensions = ['lengthCm', 'widthCm', 'heightCm', 'weightKg'] as const
const positiveInteger = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647

/** Normalizes only user input; mutable product defaults are resolved after replay checking. */
export function erpShipmentRequest(data: CreateErpShipmentDto) {
  if (!data.clientRequestId && !data.inboundNo?.trim()) throw new BadRequestException('请提供发运操作标识，重新打开单据后重试')
  if (!data.sourceWarehouseCode?.trim() || !data.warehouseCode?.trim()) throw new BadRequestException('请选择始发中转仓和目的海外仓')
  if (!data.warehouseNo?.trim()) throw new BadRequestException('请填写入仓号')
  if (!Array.isArray(data.items) || !data.items.length) throw new BadRequestException('请填写发运明细')
  const items = new Map<string, { productId: number; sku: string; expectedQty: number; remark: string; lengthCm?: number; widthCm?: number; heightCm?: number; weightKg?: number }>()
  for (const line of data.items) {
    const sku = String(line.sku || '').trim()
    if (!sku || !Number.isSafeInteger(line.productId) || line.productId <= 0 || !positiveInteger(line.expectedQty)) throw new BadRequestException('商品档案编号和发运数量须为有效正整数')
    for (const field of dimensions) if (line[field] != null && (typeof line[field] !== 'number' || !Number.isFinite(line[field]) || line[field]! <= 0)) throw new BadRequestException('商品尺寸与重量须为大于零的有效数值')
    if ([line.lengthCm, line.widthCm, line.heightCm].some(value => value != null) && ![line.lengthCm, line.widthCm, line.heightCm].every(value => value != null)) throw new BadRequestException(`${sku} 请填写完整的商品长、宽、高`)
    const previous = items.get(sku)
    if (previous) {
      if (previous.productId !== line.productId) throw new BadRequestException(`${sku} 对应多个商品档案，请重新选择`)
      for (const field of dimensions) {
        if (previous[field] != null && line[field] != null && previous[field] !== line[field]) throw new BadRequestException(`${sku} 重复明细的尺寸或重量不一致`)
        previous[field] ??= line[field]
      }
      previous.expectedQty += line.expectedQty
      if (!positiveInteger(previous.expectedQty)) throw new BadRequestException(`${sku} 合计数量超出支持范围`)
      previous.remark = [...new Set([previous.remark, String(line.remark || '').trim()].filter(Boolean))].join('；')
      if (previous.remark.length > 500) throw new BadRequestException(`${sku} 合并备注过长，请精简后重试`)
    } else items.set(sku, { productId: line.productId, sku, expectedQty: line.expectedQty, remark: String(line.remark || '').trim(),
      lengthCm: line.lengthCm, widthCm: line.widthCm, heightCm: line.heightCm, weightKg: line.weightKg })
  }
  const cartons = (data.cartons || []).map((carton, index) => {
    const boxSeq = carton.boxSeq ?? index + 1
    if (!positiveInteger(boxSeq) || !Array.isArray(carton.items) || !carton.items.length) throw new BadRequestException('请填写有效的箱序号和装箱明细')
    const packed = new Map<string, number>()
    for (const line of carton.items) {
      const sku = String(line.sku || '').trim()
      if (!items.has(sku) || !positiveInteger(line.qty)) throw new BadRequestException('装箱商品须属于本单，数量须为正整数')
      packed.set(sku, (packed.get(sku) || 0) + line.qty)
    }
    return { boxSeq, boxCode: String(carton.boxCode || '').trim(), lengthCm: carton.lengthCm, widthCm: carton.widthCm, heightCm: carton.heightCm,
      grossWeightKg: carton.grossWeightKg, remark: String(carton.remark || '').trim(), items: [...packed].sort(([a], [b]) => a.localeCompare(b)).map(([sku, qty]) => ({ sku, qty })) }
  }).sort((a, b) => a.boxSeq - b.boxSeq)
  if (new Set(cartons.map(carton => carton.boxSeq)).size !== cartons.length || new Set(cartons.filter(carton => carton.boxCode).map(carton => carton.boxCode.toUpperCase())).size !== cartons.filter(carton => carton.boxCode).length) throw new BadRequestException('箱序号或箱号重复，请核对后重试')
  if (cartons.length) for (const [sku, line] of items) {
    const packed = cartons.flatMap(carton => carton.items).filter(item => item.sku === sku).reduce((sum, item) => sum + item.qty, 0)
    if (packed !== line.expectedQty) throw new BadRequestException(`${sku} 装箱合计 ${packed} 与发运数量 ${line.expectedQty} 不一致`)
  }
  const freightSeen = new Set<string>()
  const freightLines = (data.freightLines || []).map(line => {
    const sku = String(line.sku || '').trim(), item = items.get(sku)
    if (!item || freightSeen.has(sku)) throw new BadRequestException('费用商品须属于本单且不能重复')
    freightSeen.add(sku)
    if (line.inboundQty != null && line.inboundQty !== item.expectedQty) throw new BadRequestException(`${sku} 费用分摊数量与发运数量不一致`)
    for (const value of [line.seaFreightPerUnit, line.domesticFeePerUnit, line.costRmb]) if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new BadRequestException('海运费、国内费用与成本须为非负有效数值')
    return { sku, inboundQty: item.expectedQty, seaFreightPerUnit: line.seaFreightPerUnit, domesticFeePerUnit: line.domesticFeePerUnit, costRmb: line.costRmb }
  }).sort((a, b) => a.sku.localeCompare(b.sku))
  return { inboundNo: String(data.inboundNo || '').trim(), sourceWarehouseCode: data.sourceWarehouseCode.trim(), warehouseCode: data.warehouseCode.trim(),
    warehouseNo: data.warehouseNo.trim(), trackingNo: String(data.trackingNo || '').trim(), remark: String(data.remark || '').trim(), draftNo: String(data.draftNo || '').trim(),
    items: [...items.values()].sort((a, b) => a.sku.localeCompare(b.sku)), cartons, freightLines }
}

export function erpShipmentFingerprint(request: ReturnType<typeof erpShipmentRequest>) {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex')
}
