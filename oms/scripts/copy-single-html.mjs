import { copyFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const src = join(root, 'dist', 'index.html')
const dest = join(root, 'Takealot-OMS-原型.html')

copyFileSync(src, dest)

const sizeMb = (statSync(dest).size / 1024 / 1024).toFixed(2)
console.log(`\n✓ 单文件原型已生成: Takealot-OMS-原型.html (${sizeMb} MB)`)
console.log('  直接双击打开，或发给朋友即可（内容与 dev/preview 一致）\n')
