/** 浏览器端 PDF 文本提取（pdf.js） */
import * as pdfjs from 'pdfjs-dist'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export async function extractPdfTextFromFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: buf }).promise
  const chunks: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    chunks.push(
      content.items.map(item => ('str' in item ? item.str : '')).join(' '),
    )
  }
  return chunks.join('\n')
}

export async function extractPdfTextFromBase64(base64: string): Promise<string> {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const pdf = await pdfjs.getDocument({ data: bytes }).promise
  const chunks: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    chunks.push(
      content.items.map(item => ('str' in item ? item.str : '')).join(' '),
    )
  }
  return chunks.join('\n')
}
