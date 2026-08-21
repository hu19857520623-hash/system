/** Nest 编译入口可能在 dist/app/src 或 dist/backend/src，写 launcher 供 node dist/main.js 使用 */
const fs = require('fs')
const path = require('path')

const dist = path.join(__dirname, '..', 'dist')
const candidates = [
  path.join(dist, 'app', 'src', 'main.js'),
  path.join(dist, 'backend', 'src', 'main.js'),
  path.join(dist, 'src', 'main.js'),
]
const entry = candidates.find((p) => fs.existsSync(p))
const launcher = path.join(dist, 'main.js')

if (!entry) {
  console.warn('[postbuild] skip: main.js not found under dist/{app,backend,}/src')
  process.exit(0)
}

const rel = './' + path.relative(dist, entry).split(path.sep).join('/')
fs.writeFileSync(launcher, `require('${rel}');\n`)
console.log(`[postbuild] dist/main.js -> ${rel}`)
