export type OmsAsnSourceLine = {
  sku: string
  qty: number
  name: string
  boxNo: number
}

export type OmsAsnDimensionSource = {
  lengthCm?: number | null
  widthCm?: number | null
  heightCm?: number | null
}

export function buildOmsAsnItem(
  line: OmsAsnSourceLine,
  product?: OmsAsnDimensionSource,
) {
  const positive = (value: unknown) => {
    const numberValue = Number(value)
    return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined
  }
  return {
    sku: line.sku,
    qty: line.qty,
    productName: line.name,
    boxNo: line.boxNo,
    lengthCm: positive(product?.lengthCm),
    widthCm: positive(product?.widthCm),
    heightCm: positive(product?.heightCm),
  }
}
