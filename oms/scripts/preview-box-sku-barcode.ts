import { mkdir, writeFile } from 'node:fs/promises'
import { buildBoxLabelsPdf } from '../src/data/boxLabelPdf'

const output = 'output/pdf/box-sku-barcode-preview.pdf'
await mkdir('output/pdf', { recursive: true })
await writeFile(output, await buildBoxLabelsPdf([
  { referenceNo: 'RVTKL005-260924-0002', boxNo: 2, boxTotal: 2, warehouseCode: 'WMS-JHB-01', lines: [{ sku: 'TKL005-713072', qty: 10 }] },
  { referenceNo: 'RVTKL005-260924-0003', boxNo: 1, boxTotal: 1, warehouseCode: 'WMS-JHB-01', lines: [{ sku: 'TKL005-713091', qty: 18 }, { sku: 'TKL005-713072', qty: 10 }, { sku: 'TKL005-713105', qty: 1 }] },
]))
console.log(output)
