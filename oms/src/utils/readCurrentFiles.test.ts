import test from 'node:test'
import assert from 'node:assert/strict'
import { readCurrentFiles } from './readCurrentFiles'
import { reportLineImportResult } from './lineImportResult'

test('离开原页面后不回填附件，也不继续读取后续文件', async () => {
  let current = true, reads = 0, release!: (value: string) => void
  const result = readCurrentFiles(['one', 'two'], async () => { reads++; return new Promise<string>(r => { release = r }) }, () => current)
  current = false; release('old'); assert.equal(await result, null); assert.equal(reads, 1)
})
test('一批附件全部读取后才回填，读取失败不返回半批资料', async () => {
  assert.deepEqual(await readCurrentFiles(['one', 'two'], async file => file.toUpperCase(), () => true), ['ONE', 'TWO'])
  await assert.rejects(readCurrentFiles(['one', 'two'], async file => { if (file === 'two') throw Error('失败'); return file }, () => true), /失败/)
})
test('CSV 失效时不应用明细，回填后离页也不弹出旧成功消息或失败明细', async () => {
  let applied = 0
  assert.equal(await reportLineImportResult({ data: ['row'], errors: [] }, () => { applied++ }, { isCurrent: () => false }), false)
  assert.equal(applied, 0)
  // No window adapter: any stale dialog/alert would fail this test.
  for (const errors of [[], ['第2行：数量错误']]) {
    let current = true
    assert.equal(await reportLineImportResult({ data: ['row'], errors }, async () => { applied++; current = false }, { isCurrent: () => current }), false)
  }
  assert.equal(applied, 2)
})
