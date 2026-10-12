/** Presentation only: preserve document numbers, barcodes and stored identifiers. */
export function displaySkuText(value: unknown): string {
  return String(value ?? '').replace(/(^|[^a-zA-Z0-9_-])TKL\d+-([a-zA-Z0-9_-]+)/gi, '$1$2')
}
