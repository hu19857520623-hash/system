/** A -> B -> A is a new view, even if the same document is opened again. */
export function createAsyncViewScope() {
  let scope: string | null = null, revision = 0, active = false
  return {
    update(next: string) { if (!active || scope !== next) revision++; scope = next; active = true },
    dispose() { active = false; revision++ },
    capture() { const original = revision; return () => active && revision === original },
  }
}
