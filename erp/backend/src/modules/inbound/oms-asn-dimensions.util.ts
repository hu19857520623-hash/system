export type OmsAsnDimensionInput = {
  lengthCm?: unknown
  widthCm?: unknown
  heightCm?: unknown
}

export type OmsAsnCustomerDimensions = {
  lengthCm: number
  widthCm: number
  heightCm: number
}

/** Customer-declared dimensions carried by an OMS ASN. All three are atomic. */
export function normalizeOmsAsnCustomerDimensions(
  input: OmsAsnDimensionInput,
): OmsAsnCustomerDimensions | null {
  const raw = [input.lengthCm, input.widthCm, input.heightCm]
  const provided = raw.some((value) => value !== undefined && value !== null && value !== '')
  if (!provided) return null

  const [lengthCm, widthCm, heightCm] = raw.map(Number)
  if (![lengthCm, widthCm, heightCm].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('长、宽、高必须同时填写且大于 0')
  }
  return { lengthCm, widthCm, heightCm }
}
