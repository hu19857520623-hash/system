/** A read result belongs to one dialog selection and one current session. */
export function createReturnReadGate(scope: () => string | null) {
  let generation = 0
  return {
    invalidate() { ++generation },
    begin(visible: () => boolean) {
      const version = ++generation, identity = scope()
      return () => !!identity && version === generation && identity === scope() && visible()
    },
  }
}
