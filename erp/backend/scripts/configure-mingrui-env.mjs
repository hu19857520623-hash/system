#!/usr/bin/env node
/**
 * Upsert Mingrui AI-OPS credentials into erp/.env on the server.
 * Usage:
 *   MINGRUI_APP_KEY='...' MINGRUI_APP_TOKEN='...' node scripts/configure-mingrui-env.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')

const entries = {
  MINGRUI_API_BASE: process.env.MINGRUI_API_BASE || 'https://ws.ai-ops.vip',
  MINGRUI_APP_KEY: process.env.MINGRUI_APP_KEY || '',
  MINGRUI_APP_TOKEN: process.env.MINGRUI_APP_TOKEN || '',
}

if (!entries.MINGRUI_APP_KEY || !entries.MINGRUI_APP_TOKEN) {
  console.error('Set MINGRUI_APP_KEY and MINGRUI_APP_TOKEN in the environment first.')
  process.exit(1)
}

let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
for (const [key, value] of Object.entries(entries)) {
  const line = `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  content = pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`
}
fs.writeFileSync(envPath, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
console.log(`Updated ${envPath}`)
