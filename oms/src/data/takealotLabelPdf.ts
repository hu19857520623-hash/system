import { PDFDocument } from 'pdf-lib'
import {
  extractPdfTextModelFromData,
  type TakealotPdfTextPage,
  type TakealotPdfTextToken,
} from './takealotPdfText'

export const TAKEALOT_LABEL_GRID = {
  columns: 5,
  maxRows: 9,
  cellWidth: 113.386,
  cellHeight: 84.756,
  nominalLeft: 14.173,
  nominalBottom: 39.543,
  barcodeOffsetX: 4.62,
  barcodeOffsetY: 7.73,
} as const

export type TakealotLabelBlockingCode =
  | 'invalid-page-size'
  | 'invalid-grid'
  | 'invalid-barcode'
  | 'ambiguous-barcode'
  | 'unreadable-cell'
  | 'scanned-page'
  | 'empty-document'
  | 'crop-failed'

export interface TakealotLabelBlockingState {
  code: TakealotLabelBlockingCode
  message: string
  page?: number
  row?: number
  column?: number
}

export interface TakealotLabelCellBounds {
  left: number
  bottom: number
  width: number
  height: number
}

export interface TakealotBarcodeFallbackContext {
  file: File
  page: TakealotPdfTextPage
  pageNumber: number
  row: number
  column: number
  bounds: TakealotLabelCellBounds
}

/** BarcodeDetector / ZXing adapters can implement this without coupling this module to either dependency. */
export interface TakealotBarcodeFallback {
  name: 'BarcodeDetector' | 'ZXing' | string
  detect(context: TakealotBarcodeFallbackContext): Promise<string[]>
}

export interface TakealotLabelCrop {
  dataUrl: string
  fileName: string
  page: number
  row: number
  column: number
  barcode: string
  unitIndex: number
  title?: string
  bounds: TakealotLabelCellBounds
}

export interface TakealotLabelGridInfo {
  columns: 5
  maxRows: 9
  cellWidth: number
  cellHeight: number
  left: number
  bottom: number
  inferredColumnStep: number
  inferredRowStep: number
}

export interface TakealotLabelPdfResult {
  status: 'ok' | 'blocked'
  pageCount: number
  grid: TakealotLabelGridInfo
  crops: TakealotLabelCrop[]
  blockingStates: TakealotLabelBlockingState[]
}

interface BarcodeAnchor {
  barcode: string
  x: number
  y: number
  width: number
  tokens: TakealotPdfTextToken[]
  row: number
  column: number
}

interface CellCoordinate {
  page: number
  row: number
  column: number
}

const median = (values: number[], fallback: number) => {
  if (!values.length) return fallback
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

export function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false
  const digits = [...value].map(Number)
  const check = digits.pop()
  const sum = digits.reduce(
    (total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3),
    0,
  )
  return (10 - (sum % 10)) % 10 === check
}

function rowGroups(tokens: TakealotPdfTextToken[]): TakealotPdfTextToken[][] {
  const rows = new Map<number, TakealotPdfTextToken[]>()
  for (const token of tokens) {
    const digits = token.text.replace(/\D/g, '')
    if (!digits || digits.length > 13) continue
    const key = Math.round(token.y / 2) * 2
    const row = rows.get(key) || []
    row.push(token)
    rows.set(key, row)
  }
  return [...rows.values()].map(row => row.sort((a, b) => a.x - b.x))
}

function nominalCellForPoint(x: number, y: number): Omit<CellCoordinate, 'page'> | null {
  const column = Math.floor((x - TAKEALOT_LABEL_GRID.nominalLeft) / TAKEALOT_LABEL_GRID.cellWidth)
  const row = Math.floor((y - TAKEALOT_LABEL_GRID.nominalBottom) / TAKEALOT_LABEL_GRID.cellHeight)
  if (
    column < 0
    || column >= TAKEALOT_LABEL_GRID.columns
    || row < 0
    || row >= TAKEALOT_LABEL_GRID.maxRows
  ) return null
  return { row, column }
}

function findBarcodeAnchors(page: TakealotPdfTextPage): BarcodeAnchor[] {
  const candidates: BarcodeAnchor[] = []
  for (const rowTokens of rowGroups(page.tokens)) {
    for (let start = 0; start < rowTokens.length; start += 1) {
      let digits = ''
      const used: TakealotPdfTextToken[] = []
      for (let end = start; end < Math.min(rowTokens.length, start + 13); end += 1) {
        const token = rowTokens[end]
        const tokenDigits = token.text.replace(/\D/g, '')
        if (!tokenDigits) continue
        if (used.length) {
          const previous = used[used.length - 1]
          const gap = token.x - (previous.x + previous.width)
          if (gap > 25) break
        }
        digits += tokenDigits
        used.push(token)
        if (digits.length > 13) break
        if (digits.length !== 13 || !isValidEan13(digits)) continue

        const x = used[0].x
        const right = Math.max(...used.map(item => item.x + item.width))
        const cell = nominalCellForPoint(x, used[0].y)
        if (!cell || right - x > TAKEALOT_LABEL_GRID.cellWidth * 0.92) continue
        candidates.push({
          barcode: digits,
          x,
          y: used[0].y,
          width: right - x,
          tokens: [...used],
          ...cell,
        })
        break
      }
    }
  }

  const byCell = new Map<string, BarcodeAnchor[]>()
  for (const candidate of candidates) {
    const key = `${candidate.row}:${candidate.column}`
    const list = byCell.get(key) || []
    list.push(candidate)
    byCell.set(key, list)
  }

  return [...byCell.values()].map(list => {
    const expectedX = TAKEALOT_LABEL_GRID.nominalLeft
      + list[0].column * TAKEALOT_LABEL_GRID.cellWidth
      + TAKEALOT_LABEL_GRID.barcodeOffsetX
    return [...list].sort((a, b) => {
      const xScore = Math.abs(a.x - expectedX) - Math.abs(b.x - expectedX)
      return xScore || a.tokens.length - b.tokens.length
    })[0]
  })
}

function inferGrid(anchors: BarcodeAnchor[]): TakealotLabelGridInfo {
  const left = median(
    anchors.map(anchor =>
      anchor.x
      - anchor.column * TAKEALOT_LABEL_GRID.cellWidth
      - TAKEALOT_LABEL_GRID.barcodeOffsetX),
    TAKEALOT_LABEL_GRID.nominalLeft,
  )
  const bottom = median(
    anchors.map(anchor =>
      anchor.y
      - anchor.row * TAKEALOT_LABEL_GRID.cellHeight
      - TAKEALOT_LABEL_GRID.barcodeOffsetY),
    TAKEALOT_LABEL_GRID.nominalBottom,
  )

  const columnSteps: number[] = []
  const rowSteps: number[] = []
  for (let i = 0; i < anchors.length; i += 1) {
    for (let j = i + 1; j < anchors.length; j += 1) {
      const a = anchors[i]
      const b = anchors[j]
      if (a.row === b.row && a.column !== b.column) {
        columnSteps.push(Math.abs((b.x - a.x) / (b.column - a.column)))
      }
      if (a.column === b.column && a.row !== b.row) {
        rowSteps.push(Math.abs((b.y - a.y) / (b.row - a.row)))
      }
    }
  }

  return {
    columns: 5,
    maxRows: 9,
    cellWidth: TAKEALOT_LABEL_GRID.cellWidth,
    cellHeight: TAKEALOT_LABEL_GRID.cellHeight,
    left,
    bottom,
    inferredColumnStep: median(columnSteps, TAKEALOT_LABEL_GRID.cellWidth),
    inferredRowStep: median(rowSteps, TAKEALOT_LABEL_GRID.cellHeight),
  }
}

function cellBounds(grid: TakealotLabelGridInfo, row: number, column: number): TakealotLabelCellBounds {
  return {
    left: grid.left + column * grid.cellWidth,
    bottom: grid.bottom + row * grid.cellHeight,
    width: grid.cellWidth,
    height: grid.cellHeight,
  }
}

function tokenCell(token: TakealotPdfTextToken, grid: TakealotLabelGridInfo): Omit<CellCoordinate, 'page'> | null {
  const column = Math.floor((token.x - grid.left) / grid.cellWidth)
  const row = Math.floor((token.y - grid.bottom) / grid.cellHeight)
  if (column < 0 || column >= grid.columns || row < 0 || row >= grid.maxRows) return null
  return { row, column }
}

function invalidBarcodeCells(page: TakealotPdfTextPage, grid: TakealotLabelGridInfo): CellCoordinate[] {
  const invalid: CellCoordinate[] = []
  for (const rowTokens of rowGroups(page.tokens)) {
    let cluster: TakealotPdfTextToken[] = []
    const flush = () => {
      const digits = cluster.map(token => token.text.replace(/\D/g, '')).join('')
      if (digits.length === 13 && !isValidEan13(digits)) {
        const cell = tokenCell(cluster[0], grid)
        if (cell) invalid.push({ page: page.pageNumber, ...cell })
      }
      cluster = []
    }
    for (const token of rowTokens) {
      const previous = cluster[cluster.length - 1]
      if (previous && token.x - (previous.x + previous.width) > 25) flush()
      cluster.push(token)
    }
    flush()
  }
  return invalid
}

function cellTitle(page: TakealotPdfTextPage, grid: TakealotLabelGridInfo, row: number, column: number) {
  return page.tokens
    .filter(token => {
      const cell = tokenCell(token, grid)
      return cell?.row === row
        && cell.column === column
        && !/^[\d\s|]+$/.test(token.text)
        && !/^[PM]$/.test(token.text)
    })
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map(token => token.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || undefined
}

async function bytesToDataUrl(bytes: Uint8Array): Promise<string> {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return `data:application/pdf;base64,${btoa(binary)}`
}

async function cropVectorPdf(
  source: PDFDocument,
  pageNumber: number,
  bounds: TakealotLabelCellBounds,
): Promise<string> {
  const output = await PDFDocument.create()
  const sourcePage = source.getPage(pageNumber - 1)
  const embedded = await output.embedPage(sourcePage, {
    left: bounds.left,
    bottom: bounds.bottom,
    right: bounds.left + bounds.width,
    top: bounds.bottom + bounds.height,
  })
  const page = output.addPage([bounds.width, bounds.height])
  page.drawPage(embedded, {
    x: 0,
    y: 0,
    width: bounds.width,
    height: bounds.height,
  })
  return bytesToDataUrl(await output.save())
}

export async function parseTakealotProductLabelPdf(
  file: File,
  options: { fallbacks?: TakealotBarcodeFallback[] } = {},
): Promise<TakealotLabelPdfResult> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  // pdf.js transfers ownership of its input buffer to the worker.
  const textModel = await extractPdfTextModelFromData(bytes.slice())
  const sourcePdf = await PDFDocument.load(bytes)
  const blockingStates: TakealotLabelBlockingState[] = []
  const pageAnchors = textModel.pages.map(page => ({ page, anchors: findBarcodeAnchors(page) }))
  const allAnchors = pageAnchors.flatMap(entry => entry.anchors)
  const grid = inferGrid(allAnchors)

  if (!textModel.pages.length) {
    blockingStates.push({ code: 'empty-document', message: 'SKU 标签 PDF 没有页面' })
  }

  const gridValid = Math.abs(grid.left - TAKEALOT_LABEL_GRID.nominalLeft) <= 4
    && Math.abs(grid.bottom - TAKEALOT_LABEL_GRID.nominalBottom) <= 4
    && Math.abs(grid.inferredColumnStep - TAKEALOT_LABEL_GRID.cellWidth) <= 2
    && Math.abs(grid.inferredRowStep - TAKEALOT_LABEL_GRID.cellHeight) <= 2

  if (allAnchors.length && !gridValid) {
    blockingStates.push({
      code: 'invalid-grid',
      message: 'SKU 标签网格与 Takealot 5 列模板不一致，无法安全裁切',
    })
  }

  const resolved: Array<{ page: TakealotPdfTextPage; anchor: BarcodeAnchor }> = []
  for (const { page, anchors } of pageAnchors) {
    if (
      Math.abs(page.width - 595.276) > 8
      || Math.abs(page.height - 841.89) > 8
      || page.rotation !== 0
    ) {
      blockingStates.push({
        code: 'invalid-page-size',
        page: page.pageNumber,
        message: `第 ${page.pageNumber} 页不是未旋转的 A4 Takealot 标签模板`,
      })
      continue
    }

    if (!page.tokens.length) {
      blockingStates.push({
        code: 'scanned-page',
        page: page.pageNumber,
        message: `第 ${page.pageNumber} 页为图片/扫描页，需 BarcodeDetector 或 ZXing 识别后才能提交`,
      })
      continue
    }

    const anchorsByCell = new Map(anchors.map(anchor => [`${anchor.row}:${anchor.column}`, anchor]))
    const occupied = new Map<string, Omit<CellCoordinate, 'page'>>()
    for (const token of page.tokens) {
      const cell = tokenCell(token, grid)
      if (cell) occupied.set(`${cell.row}:${cell.column}`, cell)
    }

    for (const invalid of invalidBarcodeCells(page, grid)) {
      blockingStates.push({
        code: 'invalid-barcode',
        page: invalid.page,
        row: invalid.row,
        column: invalid.column,
        message: `第 ${invalid.page} 页 R${invalid.row + 1}C${invalid.column + 1} 的 EAN-13 校验位无效`,
      })
    }

    for (const [key, cell] of occupied) {
      const anchor = anchorsByCell.get(key)
      if (anchor) {
        resolved.push({ page, anchor })
        continue
      }

      const bounds = cellBounds(grid, cell.row, cell.column)
      const detected = new Set<string>()
      for (const fallback of options.fallbacks || []) {
        const values = await fallback.detect({
          file,
          page,
          pageNumber: page.pageNumber,
          row: cell.row,
          column: cell.column,
          bounds,
        })
        values.filter(isValidEan13).forEach(value => detected.add(value))
      }

      if (detected.size === 1) {
        resolved.push({
          page,
          anchor: {
            barcode: [...detected][0],
            x: bounds.left + TAKEALOT_LABEL_GRID.barcodeOffsetX,
            y: bounds.bottom + TAKEALOT_LABEL_GRID.barcodeOffsetY,
            width: 0,
            tokens: [],
            row: cell.row,
            column: cell.column,
          },
        })
      } else {
        blockingStates.push({
          code: detected.size > 1 ? 'ambiguous-barcode' : 'unreadable-cell',
          page: page.pageNumber,
          row: cell.row,
          column: cell.column,
          message: detected.size > 1
            ? `第 ${page.pageNumber} 页 R${cell.row + 1}C${cell.column + 1} 检出多个条码`
            : `第 ${page.pageNumber} 页 R${cell.row + 1}C${cell.column + 1} 有标签内容但无法读取有效 EAN-13`,
        })
      }
    }
  }

  resolved.sort((a, b) =>
    a.page.pageNumber - b.page.pageNumber
    || a.anchor.row - b.anchor.row
    || a.anchor.column - b.anchor.column)

  const unitCounts = new Map<string, number>()
  const crops: TakealotLabelCrop[] = []
  for (const { page, anchor } of resolved) {
    const unitIndex = (unitCounts.get(anchor.barcode) || 0) + 1
    unitCounts.set(anchor.barcode, unitIndex)
    const bounds = cellBounds(grid, anchor.row, anchor.column)
    try {
      crops.push({
        dataUrl: await cropVectorPdf(sourcePdf, page.pageNumber, bounds),
        fileName: `${file.name.replace(/\.pdf$/i, '')}-p${String(page.pageNumber).padStart(2, '0')}-r${String(anchor.row + 1).padStart(2, '0')}-c${String(anchor.column + 1).padStart(2, '0')}-${anchor.barcode}.pdf`,
        page: page.pageNumber,
        row: anchor.row,
        column: anchor.column,
        barcode: anchor.barcode,
        unitIndex,
        title: cellTitle(page, grid, anchor.row, anchor.column),
        bounds,
      })
    } catch (error) {
      blockingStates.push({
        code: 'crop-failed',
        page: page.pageNumber,
        row: anchor.row,
        column: anchor.column,
        message: `第 ${page.pageNumber} 页 R${anchor.row + 1}C${anchor.column + 1} 裁切失败：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  if (!resolved.length && !blockingStates.length) {
    blockingStates.push({
      code: 'empty-document',
      message: 'SKU 标签 PDF 未发现任何占用标签格',
    })
  }

  return {
    status: blockingStates.length ? 'blocked' : 'ok',
    pageCount: textModel.pageCount,
    grid,
    crops,
    blockingStates,
  }
}
