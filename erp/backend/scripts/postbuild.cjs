/** Nest rootDir=.. 时入口在 dist/backend/src/main.js，写 launcher 供 nest start 使用 */
const fs = require('fs')
const path = require('path')

const dist = path.join(__dirname, '..', 'dist')
const entry = path.join(dist, 'backend', 'src', 'main.js')
const launcher = path.join(dist, 'main.js')

if (!fs.existsSync(entry)) {
  console.warn('[postbuild] skip: dist/backend/src/main.js not found')
  process.exit(0)
}

fs.writeFileSync(launcher, "require('./backend/src/main.js');\n")
console.log('[postbuild] dist/main.js launcher ready')
