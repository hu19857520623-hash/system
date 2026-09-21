import { create as createQr } from 'qrcode'

export function qrModules(text: string) {
  const payload = String(text || '').trim() || '0'
  return createQr(payload, { errorCorrectionLevel: 'M' }).modules
}

export function qrSvg(text: string, quiet = 1) {
  const payload = String(text || '').trim() || '0'
  const modules = qrModules(payload)
  const n = modules.size
  const dim = n + quiet * 2
  const rects: string[] = []
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (modules.get(y, x)) {
        rects.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`)
      }
    }
  }
  const label = payload.replace(/[<>&"]/g, (char) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char] || char
  ))
  return `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="${label}">${rects.join('')}</svg>`
}
