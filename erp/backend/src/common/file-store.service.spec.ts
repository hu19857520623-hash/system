import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { FileStoreService } from './file-store.service'

describe('FileStoreService', () => {
  let root: string
  let files: FileStoreService

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-files-'))
    files = new FileStoreService().useRoot(root)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('writes under the configured root and reads the same bytes', () => {
    const { relativePath } = files.write('inbound', 'pod.pdf', Buffer.from('hello'))
    expect(relativePath.replace(/\\/g, '/')).toBe('inbound/pod.pdf')
    expect(files.read(relativePath).toString()).toBe('hello')
  })

  it('strips directory components from file names', () => {
    const { relativePath, fullPath } = files.write('inbound', `folder${path.sep}..${path.sep}secret.txt`, 'x')
    expect(path.basename(relativePath)).toBe('secret.txt')
    expect(fullPath.startsWith(path.resolve(root))).toBe(true)
    expect(fs.existsSync(path.join(root, 'secret.txt'))).toBe(false)
  })

  it('rejects a directory that escapes the upload root', () => {
    expect(() => files.write('..', 'secret.txt', 'x')).toThrow(/非法文件路径/)
  })

  it('rejects relative reads that escape the upload root', () => {
    expect(files.exists(`..${path.sep}secret.txt`)).toBe(false)
    expect(() => files.read(`..${path.sep}secret.txt`)).toThrow(/非法文件路径/)
  })
})
