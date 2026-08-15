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
    const lengthCm = Number(c.lengthCm)
    const widthCm = Number(c.widthCm)
    const heightCm = Number(c.heightCm)
    const grossWeightKg = Number(c.grossWeightKg) || 0
    if (lengthCm <= 0 || widthCm <= 0 || heightCm <= 0) {
      throw new Error(`第 ${i + 1} 箱尺寸无效`)
    }
    const volumeCbm = (lengthCm * widthCm * heightCm) / 1_000_000
    return {
      cartonNo: i + 1,
      lengthCm,
      widthCm,
      heightCm,
      grossWeightKg,
      volumeCbm: round6(volumeCbm),
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
