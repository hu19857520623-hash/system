/** Keep a file batch atomic in the form; stop reading after its originating view leaves. */
export async function readCurrentFiles<T, R>(files: Iterable<T>, read: (file: T) => Promise<R>, isCurrent: () => boolean): Promise<R[] | null> {
  const result: R[] = []
  for (const file of files) {
    if (!isCurrent()) return null
    const row = await read(file)
    if (!isCurrent()) return null
    result.push(row)
  }
  return isCurrent() ? result : null
}
