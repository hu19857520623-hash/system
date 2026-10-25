// Inventory only: a handler's presence does not prove runtime behavior or flow completion.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require('../erp/backend/node_modules/typescript')
const { parse: parseSfc } = require('../erp/frontend/node_modules/@vue/compiler-sfc')
const { parse: parseTemplate } = require('../erp/frontend/node_modules/@vue/compiler-dom')
const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'output/workflow-audit-2026-10-16')
fs.mkdirSync(output, { recursive: true })
const controls = [], dialogs = [], files = []
const relative = file => path.relative(root, file).replaceAll('\\', '/')
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory()
    ? walk(path.join(dir, item.name)) : [path.join(dir, item.name)])
}
function textOf(node) { return String(node?.loc?.source || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) }
for (const area of ['erp/frontend/src', 'oms/src']) {
  for (const file of walk(path.join(root, area)).filter(file => /\.(vue|tsx)$/.test(file) && !/\.(test|spec)\.tsx$/.test(file))) {
    const source = fs.readFileSync(file, 'utf8'), filename = relative(file)
    const before = controls.length
    if (file.endsWith('.vue')) {
      const { descriptor } = parseSfc(source)
      if (!descriptor.template) continue
      const tree = parseTemplate(descriptor.template.content)
      const visit = (node, parents = []) => {
        if (node.type === 1) {
          const props = Object.fromEntries(node.props.map(prop => prop.type === 6
            ? [prop.name, prop.value?.content ?? true]
            : [`${prop.name}:${prop.arg?.content || ''}`, prop.exp?.content || '']))
          const line = node.loc.start.line + descriptor.template.loc.start.line - 1
          if (['el-button', 'button', 'router-link', 'a', 'el-dropdown-item', 'el-menu-item'].includes(node.tag)
            || node.props.some(prop => prop.type === 7 && prop.name === 'on' && ['click', 'dblclick'].includes(prop.arg?.content))) {
            const events = Object.entries(props).filter(([key]) => key.startsWith('on:'))
            const navigation = props.to || props['bind:to'] || props.href || props['bind:href']
            const submit = props['native-type'] === 'submit' || props.type === 'submit'
            const interactiveParent = parents.some(parent => ['el-dropdown', 'el-upload', 'el-popconfirm', 'el-form', 'form'].includes(parent.tag))
            controls.push({ system: 'ERP', file: filename, line, tag: node.tag, label: textOf(node), events, navigation,
              disabled: props.disabled || props['bind:disabled'] || null,
              loading: props['bind:loading'] || null,
              staticReview: events.length || navigation || submit || interactiveParent ? 'handler-or-container-present; runtime-unverified' : 'needs-review-no-direct-action' })
          }
          if (['el-dialog', 'el-drawer'].includes(node.tag)) dialogs.push({ system: 'ERP', file: filename, line, title: props.title || props['bind:title'], closable: props['show-close'] !== 'false', content: textOf(node), runtimeVerified: false })
        }
        for (const child of node.children || []) visit(child, node.type === 1 ? [...parents, node] : parents)
      }
      visit(tree)
    } else {
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const visit = node => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(tree)
          const attrs = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(prop => [prop.name.getText(tree), prop.initializer?.getText(tree) || true]))
          const spread = node.attributes.properties.some(ts.isJsxSpreadAttribute)
          if (['Button', 'button', 'Link', 'NavLink', 'a'].includes(tag) || attrs.onClick || attrs.onDoubleClick) {
            const events = Object.entries(attrs).filter(([key]) => /^on[A-Z]/.test(key))
            const label = ts.isJsxOpeningElement(node) ? node.parent.children.map(child => child.getText(tree)).join(' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) : ''
            const isSubmit = attrs.type === '"submit"' || attrs.type === "'submit'"
            let parent = node.parent, parentLink = false
            while (parent && !ts.isSourceFile(parent)) {
              if (ts.isJsxElement(parent) && ['Link', 'NavLink', 'a'].includes(parent.openingElement.tagName.getText(tree))) parentLink = true
              parent = parent.parent
            }
            controls.push({ system: 'OMS', file: filename, line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1, tag, label,
              events, navigation: attrs.to || attrs.href, disabled: attrs.disabled || null, loading: attrs.loading || null,
              parentLink,
              staticReview: events.length || attrs.to || attrs.href || spread || isSubmit || parentLink ? 'handler-or-container-present; runtime-unverified' : 'needs-review-no-direct-action' })
          }
          if (/Modal|Dialog|Drawer/.test(tag)) dialogs.push({ system: 'OMS', file: filename, line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1, tag, title: attrs.title, onClose: attrs.onClose, runtimeVerified: false })
        }
        ts.forEachChild(node, visit)
      }
      visit(tree)
    }
    files.push({ file: filename, controls: controls.length - before, runtimeVerified: false })
  }
}
const summary = {
  generatedAt: new Date().toISOString(), scope: 'All ERP Vue and OMS TSX pages/components; excludes native service actions and conditional runtime variants',
  totalControls: controls.length, totalDialogs: dialogs.length, sourceFiles: files.length,
  candidates: controls.filter(row => row.staticReview.startsWith('needs-review')),
  erpControls: controls.filter(row => row.system === 'ERP').length,
  omsControls: controls.filter(row => row.system === 'OMS').length,
  runtimeVerified: 0,
}
fs.writeFileSync(path.join(output, 'controls.json'), JSON.stringify({ summary, files, dialogs, controls }, null, 2))
fs.writeFileSync(path.join(output, 'review-candidates.md'), '# 按钮静态检查候选项\n\n以下是待人工检查项，不等同于已证实缺陷。父组件、表单或上传控件可能提供操作行为。\n\n' + summary.candidates.map(row => `- ${row.file}:${row.line} · ${row.label || row.tag}`).join('\n') + '\n')
console.log(JSON.stringify({ ...summary, candidates: summary.candidates.length }))
