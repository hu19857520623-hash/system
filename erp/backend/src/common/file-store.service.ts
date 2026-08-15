import { Injectable } from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'

@Injectable()
export class FileStoreService {
  private root = path.join(process.cwd(), 'uploads')

  ensureDir(sub: string) {
    const dir = path.join(this.root, sub)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  write(sub: string, fileName: string, content: string | Buffer) {
    const dir = this.ensureDir(sub)
    const full = path.join(dir, fileName)
    fs.writeFileSync(full, content)
    return { relativePath: path.join(sub, fileName).replace(/\\/g, '/'), fullPath: full }
  }

  read(relativePath: string): Buffer {
    const full = path.join(this.root, relativePath)
    if (!fs.existsSync(full)) throw new Error('文件不存在')
    return fs.readFileSync(full)
  }

  exists(relativePath: string) {
    return fs.existsSync(path.join(this.root, relativePath))
  }
}
