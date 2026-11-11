import { effectScope, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useReturnInspectionPhotos } from './useReturnInspectionPhotos'

function deferred() {
  let resolve!: (value: ArrayBuffer) => void
  let reject!: (error: Error) => void
  const promise = new Promise<ArrayBuffer>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const bytes = () => new Uint8Array([1, 2, 3]).buffer
const photo = (name: string) => ({ name, arrayBuffer: vi.fn(async () => bytes()) })
function setup() {
  const owner = effectScope(), scope = ref<string | null>('actor7:return.receive'), visible = ref(true), submitting = ref(false)
  const form = owner.run(() => useReturnInspectionPhotos(() => scope.value, visible, submitting))!
  return { owner, scope, visible, submitting, form }
}

describe('return inspection photo read and recovery', () => {
  it('never exposes a partial selection while reading, and blocks concurrent selection and mutation', async () => {
    const h = setup(), pending = deferred(), first = photo('one.png')
    const run = h.form.add([first, { name: 'two.png', arrayBuffer: () => pending.promise }])
    await Promise.resolve()
    expect(h.form.reading.value).toBe(true)
    expect(h.form.ready.value).toBe(false)
    expect(h.form.photos.value).toEqual([])
    const concurrent = photo('three.png')
    await h.form.add([concurrent])
    expect(concurrent.arrayBuffer).not.toHaveBeenCalled()
    pending.resolve(bytes())
    await run
    expect(h.form.photos.value.map(p => p.fileName)).toEqual(['one.png', 'two.png'])
    expect(h.form.photos.value[0]?.contentBase64).toBe('AQID')
    h.submitting.value = true
    h.form.remove(0)
    await h.form.add([concurrent])
    expect(h.form.photos.value).toHaveLength(2)
    expect(concurrent.arrayBuffer).not.toHaveBeenCalled()
    h.owner.stop()
  })

  it('retains prior photos on a failed batch, reports Chinese recovery and retries without duplicating the partially read files', async () => {
    const h = setup(), one = photo('one.png'), two = photo('two.png')
    await h.form.add([photo('existing.png')])
    two.arrayBuffer.mockRejectedValueOnce(Error('NotReadableError: external path'))
    await h.form.add([one, two])
    expect(h.form.photos.value.map(p => p.fileName)).toEqual(['existing.png'])
    expect(h.form.error.value).toContain('照片读取失败')
    expect(h.form.error.value).not.toContain('NotReadableError')
    expect(h.form.ready.value).toBe(false)
    await h.form.retry()
    expect(h.form.photos.value.map(p => p.fileName)).toEqual(['existing.png', 'one.png', 'two.png'])
    expect(h.form.error.value).toBe('')
    expect(h.form.ready.value).toBe(true)
    h.owner.stop()
  })

  it.each(['close', 'scope', 'reopen', 'dispose'] as const)('ignores a delayed selection after %s', async reason => {
    const h = setup(), pending = deferred()
    const run = h.form.add([{ name: 'old.png', arrayBuffer: () => pending.promise }])
    if (reason === 'close' || reason === 'reopen') h.visible.value = false
    if (reason === 'scope') h.scope.value = null
    if (reason === 'dispose') h.owner.stop()
    if (reason === 'reopen') {
      h.visible.value = true
      await h.form.add([photo('new.png')])
    }
    pending.resolve(bytes())
    await run
    expect(h.form.photos.value.map(p => p.fileName)).toEqual(reason === 'reopen' ? ['new.png'] : [])
    expect(h.form.reading.value).toBe(false)
    expect(h.form.error.value).toBe('')
    h.owner.stop()
  })

  it('ignores a delayed file failure after another return is selected', async () => {
    const h = setup(), pending = deferred()
    const run = h.form.add([{ name: 'old.png', arrayBuffer: () => pending.promise }])
    h.form.reset()
    await h.form.add([photo('current.png')])
    pending.reject(Error('old read failed'))
    await expect(run).resolves.toBeUndefined()
    expect(h.form.error.value).toBe('')
    expect(h.form.photos.value.map(p => p.fileName)).toEqual(['current.png'])
    h.owner.stop()
  })

  it('allows explicitly abandoning only the failed selection and removing an unwanted prior photo', async () => {
    const h = setup(), failed = photo('failed.png')
    await h.form.add([photo('keep.png')])
    failed.arrayBuffer.mockRejectedValueOnce(Error('read failed'))
    await h.form.add([failed])
    h.form.discardFailed()
    await h.form.retry()
    expect(failed.arrayBuffer).toHaveBeenCalledTimes(1)
    expect(h.form.ready.value).toBe(true)
    expect(h.form.photos.value).toHaveLength(1)
    h.form.remove(0)
    expect(h.form.photos.value).toEqual([])
    h.owner.stop()
  })

  it('rejects an empty file without adding the rest of its batch or losing prior photos', async () => {
    const h = setup()
    await h.form.add([photo('keep.png')])
    await h.form.add([photo('one.png'), { name: 'empty.png', arrayBuffer: async () => new ArrayBuffer(0) }])
    expect(h.form.photos.value.map(p => p.fileName)).toEqual(['keep.png'])
    expect(h.form.error.value).toContain('照片读取失败')
    expect(h.form.ready.value).toBe(false)
    h.owner.stop()
  })

  it('rechecks storage-derived session identity before submission even without a reactive store update', async () => {
    const owner = effectScope(), visible = ref(true), submitting = ref(false)
    let token = 'session7'
    const form = owner.run(() => useReturnInspectionPhotos(() => token, visible, submitting))!
    await form.add([photo('old-session.png')])
    token = 'session8'
    expect(form.canSubmit()).toBe(false)
    expect(form.photos.value).toEqual([])
    const pending = deferred(), run = form.add([{ name: 'slow.png', arrayBuffer: () => pending.promise }])
    token = 'session9'
    pending.resolve(bytes())
    await run
    expect(form.photos.value).toEqual([])
    expect(form.reading.value).toBe(false)
    owner.stop()
  })
})
