import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'

@Injectable()
export class FileStoreService {
  private root = path.join(process.cwd(), 'uploads')

  /** Test helper: point the store at a temp directory. */
  useRoot(root: string) {
    this.root = root
    return this
  }

  private resolvedRoot() {
    return path.resolve(this.root)
  }

  private assertInsideRoot(full: string) {
    const root = this.resolvedRoot()
    const resolved = path.resolve(full)
    const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
    if (resolved !== root && !resolved.startsWith(prefix)) {
      throw new BadRequestException('非法文件路径')
    }
    return resolved
  }

  safeFileName(fileName: string) {
    const base = path.basename(String(fileName || '')).replace(/\0/g, '')
    if (!base || base === '.' || base === '..' || /[\\/]/.test(base)) {
      throw new BadRequestException('非法文件名')
    }
    return base
  }

  ensureDir(sub: string) {
    const dir = this.assertInsideRoot(path.join(this.resolvedRoot(), sub))
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  write(sub: string, fileName: string, content: string | Buffer) {
    const safe = this.safeFileName(fileName)
    const dir = this.ensureDir(sub)
    const full = this.assertInsideRoot(path.join(dir, safe))
    fs.writeFileSync(full, content)
    return { relativePath: path.join(sub, safe).replace(/\\/g, '/'), fullPath: full }
  }

  read(relativePath: string): Buffer {
    const full = this.assertInsideRoot(path.join(this.resolvedRoot(), relativePath))
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      throw new NotFoundException('文件不存在')
    }
    return fs.readFileSync(full)
  }

  exists(relativePath: string) {
    try {
      const full = this.assertInsideRoot(path.join(this.resolvedRoot(), relativePath))
      return fs.existsSync(full) && fs.statSync(full).isFile()
    } catch {
      return false
    }
  }
}
