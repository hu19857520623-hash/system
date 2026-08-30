import { computeReturnVolumetricWeightKg } from './return.constants'
import { buildMeasurePhaseFeeLines } from './return-fee-template.util'

export type CartonInput = {
  lengthCm: number
  widthCm: number
  heightCm: number
  grossWeightKg: number
}

export type ComputedCarton = CartonInput & {
  cartonNo: number
  volumeCbm: number
  volumetricWeightKg: number
  chargeableWeightKg: number
}

export function computeCartonMeasures(cartons: CartonInput[]): ComputedCarton[] {
  return cartons.map((c, i) => {
    const lengthCm = Number(c.lengthCm)
    const widthCm = Number(c.widthCm)
    const heightCm = Number(c.heightCm)
    const grossWeightKg = Number(c.grossWeightKg) || 0
    if (lengthCm <= 0 || widthCm <= 0 || heightCm <= 0) {
      throw new Error(`第 ${i + 1} 箱尺寸无效`)
    }
    const volumeCbm = (lengthCm * widthCm * heightCm) / 1_000_000
    const volumetricWeightKg = computeReturnVolumetricWeightKg(lengthCm, widthCm, heightCm)
    const chargeableWeightKg = Math.max(grossWeightKg, volumetricWeightKg)
    return {
      cartonNo: i + 1,
      lengthCm,
      widthCm,
      heightCm,
      grossWeightKg,
      volumeCbm: round6(volumeCbm),
      volumetricWeightKg: round3(volumetricWeightKg),
      chargeableWeightKg: round3(chargeableWeightKg),
    }
  })
}

export function sumCartonTotals(cartons: ComputedCarton[]) {
  const totalVolumeCbm = round6(cartons.reduce((s, c) => s + c.volumeCbm, 0))
  const totalGrossWeightKg = round3(cartons.reduce((s, c) => s + c.grossWeightKg, 0))
  const totalChargeableWeightKg = round3(cartons.reduce((s, c) => s + c.chargeableWeightKg, 0))
  return { totalVolumeCbm, totalGrossWeightKg, totalChargeableWeightKg }
}

export type ReturnFeeLine = {
  chargeType: string
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

export function buildReturnFeeLines(
  cartonCount: number,
  totalVolumeCbm: number,
  totalSkuQty = 0,
  totalChargeableWeightKg = 0,
  rules: import('./return-fee-template.util').FeeTemplateRule[] = [],
): ReturnFeeLine[] {
  return buildMeasurePhaseFeeLines(
    {
      cartonCount,
      totalVolumeCbm,
      totalSkuQty,
      totalChargeableWeightKg,
    },
    rules,
  )
}

function _round2(n: number) {
  return Math.round(n * 100) / 100
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000
}

function round6(n: number) {
  return Math.round(n * 1_000_000) / 1_000_000
}
