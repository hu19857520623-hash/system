import { useEffect, useRef } from 'react'
import { createAsyncViewScope } from './asyncViewScope'

export function useAsyncViewScope(scope: string) {
  const view = useRef<ReturnType<typeof createAsyncViewScope> | null>(null)
  if (!view.current) view.current = createAsyncViewScope()
  view.current.update(scope)
  useEffect(() => {
    view.current!.update(scope)
    return () => view.current!.dispose()
  }, [scope])
  return view.current
}
