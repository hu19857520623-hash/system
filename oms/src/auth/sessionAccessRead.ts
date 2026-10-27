/** Coalesce profile reads and ignore results after the owning session is replaced. */
export function createSessionAccessRead<T>(options: {
  isCurrent: () => boolean
  read: () => Promise<T>
  apply: (value: T) => void
  error: (failure: unknown) => void
  settled: () => void
}) {
  let stopped = false, flight: Promise<void> | null = null
  const current = () => !stopped && options.isCurrent()
  function refresh(): Promise<void> {
    if (!current()) return Promise.resolve()
    if (flight) return flight
    const request = Promise.resolve().then(options.read).then(value => {
      if (current()) options.apply(value)
    }).catch(failure => {
      if (current()) options.error(failure)
    }).finally(() => {
      if (flight === request) flight = null
      if (current()) options.settled()
    })
    flight = request
    return request
  }
  return { refresh, dispose: () => { stopped = true; flight = null } }
}
