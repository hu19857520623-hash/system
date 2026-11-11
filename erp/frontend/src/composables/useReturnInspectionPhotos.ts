import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'

type Photo = { fileName: string; contentBase64: string }
type PhotoFile = Pick<File, 'name' | 'arrayBuffer'>

/** Local photo reads must finish in the dialog and permission scope that selected them. */
export function useReturnInspectionPhotos(scope: () => string | null, visible: Ref<boolean>, submitting: Ref<boolean>) {
  const photos = ref<Photo[]>([])
  const reading = ref(false)
  const error = ref('')
  let generation = 0
  let failed: PhotoFile[] = []
  let photoScope = scope()
  const ready = computed(() => !!scope() && visible.value && !reading.value && !error.value)

  function reset() {
    ++generation
    photos.value = []
    reading.value = false
    error.value = ''
    failed = []
    photoScope = scope()
  }

  async function add(files: Iterable<PhotoFile>) {
    if (reading.value || submitting.value || !visible.value || !scope()) return
    if (photoScope !== scope()) reset()
    const selected = Array.from(files)
    if (!selected.length) return
    const identity = scope(), version = ++generation
    const active = () => version === generation && identity === scope() && !!identity && visible.value
    reading.value = true
    error.value = ''
    failed = []
    try {
      const batch: Photo[] = []
      for (const file of selected) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (!active()) return
        if (!bytes.length) throw Error('empty photo')
        let binary = ''
        for (const byte of bytes) binary += String.fromCharCode(byte)
        batch.push({ fileName: file.name, contentBase64: btoa(binary) })
      }
      if (active()) photos.value.push(...batch)
    } catch {
      if (active()) {
        failed = selected
        error.value = '照片读取失败，本次选取的照片均未加入。请重试读取、重新选择，或放弃本次选取后继续。'
      }
    } finally {
      if (active()) reading.value = false
      else if (version === generation) reset()
    }
  }

  async function retry() { await add(failed) }
  function discardFailed() {
    if (reading.value || submitting.value) return
    failed = []
    error.value = ''
  }
  function remove(index: number) {
    if (!reading.value && !submitting.value) photos.value.splice(index, 1)
  }
  function canSubmit() {
    if (photoScope !== scope()) { reset(); return false }
    return ready.value
  }

  watch(scope, reset, { flush: 'sync' })
  watch(visible, open => { if (!open) reset() }, { flush: 'sync' })
  onScopeDispose(reset)
  return { photos, reading, error, ready, canSubmit, add, retry, discardFailed, remove, reset }
}
