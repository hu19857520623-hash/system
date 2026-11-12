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

// 把编译产物中的 @erp/shared/* 裸导入改写为 dist/shared 下的相对路径，
// 使产物在无 node_modules/@erp 链接的容器里也能解析。
const sharedDir = path.join(dist, 'shared')
function rewriteRequires(dir) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name)
    if (name.isDirectory()) {
      rewriteRequires(full)
      continue
    }
    if (!name.isFile() || !name.name.endsWith('.js')) continue
    const source = fs.readFileSync(full, 'utf8')
    const rewritten = source.replace(/require\((["'])@erp\/shared\/([^"']+)\1\)/g, (_all, quote, sub) => {
      const target = path.join(sharedDir, sub.split('/').join(path.sep))
      let relPath = path.relative(dir, target).split(path.sep).join('/')
      if (!relPath.startsWith('.')) relPath = './' + relPath
      return `require(${quote}${relPath}${quote})`
    })
    if (rewritten !== source) fs.writeFileSync(full, rewritten)
  }
}
rewriteRequires(dist)
console.log('[postbuild] @erp/shared requires rewritten to relative paths')
