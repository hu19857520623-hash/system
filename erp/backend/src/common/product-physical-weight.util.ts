type PhysicalWeightSource<T> = {
  packageWeightKg?: T | null
} | null | undefined

/**
 * Resolve a product's physical gross weight.
 *
 * Volumetric weight is intentionally excluded: it is a freight billing value,
 * not a measured product weight. When no package gross weight is available the
 * product master must remain unset until receiving/PDA measurement supplies it.
 */
export function resolveProductPhysicalWeightKg<T>(
  ...sources: PhysicalWeightSource<T>[]
): T | undefined {
  for (const source of sources) {
    if (source?.packageWeightKg != null) return source.packageWeightKg
  }
  return undefined
}
