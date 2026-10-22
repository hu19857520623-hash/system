import { BadRequestException } from '@nestjs/common'

export type OutboundCartonInput = {
  lengthCm: number
  widthCm: number
  heightCm: number
  grossWeightKg: number
}

export type OutboundComputedCarton = OutboundCartonInput & {
  cartonNo: number
  volumeCbm: number
}

export function computeOutboundCartonMeasures(cartons: OutboundCartonInput[]): OutboundComputedCarton[] {
  return cartons.map((c, i) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      throw new BadRequestException(`第 ${i + 1} 箱资料无效，请填写尺寸与毛重`)
    }
    const lengthCm = Number(c.lengthCm)
    const widthCm = Number(c.widthCm)
    const heightCm = Number(c.heightCm)
    const grossWeightKg = Number(c.grossWeightKg)
    if (![lengthCm, widthCm, heightCm].every(value => Number.isFinite(value) && value > 0)) {
      throw new BadRequestException(`第 ${i + 1} 箱尺寸无效，请填写大于零的长、宽、高`)
    }
    if (!Number.isFinite(grossWeightKg) || grossWeightKg < 0) {
      throw new BadRequestException(`第 ${i + 1} 箱毛重无效，请填写不小于零的重量`)
    }
    const volumeCbm = round6((lengthCm * widthCm * heightCm) / 1_000_000)
    if (!Number.isFinite(volumeCbm) || volumeCbm <= 0) {
      throw new BadRequestException(`第 ${i + 1} 箱体积无效，请核对长、宽、高`)
    }
    return {
      cartonNo: i + 1,
      lengthCm,
      widthCm,
      heightCm,
      grossWeightKg,
      volumeCbm,
    }
  })
}

export function sumOutboundCartonTotals(cartons: OutboundComputedCarton[]) {
  const totalVolumeM3 = round6(cartons.reduce((s, c) => s + c.volumeCbm, 0))
  const totalWeightKg = round3(cartons.reduce((s, c) => s + c.grossWeightKg, 0))
  return { totalVolumeM3, totalWeightKg }
}

function round6(n: number) {
  return Math.round(n * 1_000_000) / 1_000_000
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000
}
