import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveOmsCorsOrigins } from './cors.js'

test('OMS development CORS includes the Vite origin', () => {
  const origins = resolveOmsCorsOrigins(undefined, 'development')
  assert.equal(Array.isArray(origins), true)
  assert.ok((origins as string[]).includes('http://127.0.0.1:5173'))
})

test('OMS production CORS requires an explicit origin list', () => {
  assert.equal(resolveOmsCorsOrigins(undefined, 'production'), false)
  assert.deepEqual(
    resolveOmsCorsOrigins('https://oms.example.com, https://erp.example.com', 'production'),
    ['https://oms.example.com', 'https://erp.example.com'],
  )
})
