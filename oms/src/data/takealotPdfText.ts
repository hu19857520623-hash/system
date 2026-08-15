/** 浏览器端 PDF 文本与坐标提取（pdf.js） */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

pdfjs.GlobalWorkerOptions.workerSrc = (
  typeof window === 'undefined'
    ? new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)
    : new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url)
).toString()

export interface TakealotPdfTextToken {
  text: string
  pageNumber: number
  /** PDF point coordinates; origin is the bottom-left corner. */
  x: number
  y: number
  width: number
  height: number
  fontName?: string
  hasEol?: boolean
}

export interface TakealotPdfTextPage {
  pageNumber: number
  width: number
  height: number
  rotation: number
  text: string
  tokens: TakealotPdfTextToken[]
}

export interface TakealotPdfTextModel {
  pageCount: number
  pages: TakealotPdfTextPage[]
  text: string
}

function tokensToText(tokens: TakealotPdfTextToken[]): string {
  const rows = new Map<number, TakealotPdfTextToken[]>()
  for (const token of tokens) {
    // PDF 同一视觉行的 y 值可能有微小浮动，按 2pt 容差分组。
    const rowKey = Math.round(token.y / 2) * 2
    const row = rows.get(rowKey) || []
    row.push(token)
    rows.set(rowKey, row)
  }
  return [...rows.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, row]) => row.sort((a, b) => a.x - b.x).map(item => item.text).join(' '))
    .join('\n')
}

export async function extractPdfTextModelFromData(
  data: ArrayBuffer | Uint8Array,
): Promise<TakealotPdfTextModel> {
  const pdf = await pdfjs.getDocument({ data }).promise
  const pages: TakealotPdfTextPage[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const tokens: TakealotPdfTextToken[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const transform = 'transform' in item ? item.transform : undefined
      tokens.push({
        text: item.str.trim(),
        pageNumber: i,
        x: Number(transform?.[4] ?? 0),
        y: Number(transform?.[5] ?? 0),
        width: Number('width' in item ? item.width : 0),
        height: Number('height' in item ? item.height : 0),
        fontName: 'fontName' in item ? item.fontName : undefined,
        hasEol: 'hasEOL' in item ? item.hasEOL : undefined,
      })
    }
    pages.push({
      pageNumber: i,
      width: viewport.width,
      height: viewport.height,
      rotation: viewport.rotation,
      text: tokensToText(tokens),
      tokens,
    })
  }
  const text = pages.map(page => page.text).join('\n')
  return { pageCount: pages.length, pages, text }
}

export async function extractPdfTextModelFromFile(file: File): Promise<TakealotPdfTextModel> {
  return extractPdfTextModelFromData(await file.arrayBuffer())
}

/** 兼容原调用方：继续返回按视觉行排序的纯文本。 */
export async function extractPdfTextFromFile(file: File): Promise<string> {
  return (await extractPdfTextModelFromFile(file)).text
}
