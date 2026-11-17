export const priceTiers = ['A','B','C','D'] as const
export type Prices = Record<typeof priceTiers[number], number | null>
export type PriceDraft = { sku: string; name?: string; prices: Partial<Prices> }
export const priceImportHeaders = ['SKU','商品名称','A档价格','B档价格','C档价格','D档价格']

/** CSV supports quoted commas, escaped quotes and line breaks, without evaluating cells. */
export function priceCsvGrid(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, ''), delimiter = text.split(/\r?\n/,1)[0]?.includes('\t') && !text.split(/\r?\n/,1)[0]?.includes(',') ? '\t' : ','
  const rows: string[][] = [];let row: string[] = [], cell = '', quoted = false, closed = false
  for (let i=0;i<text.length;i++) {
    const c=text[i]
    if (quoted) {
      if (c==='"' && text[i+1]==='"') {cell+='"';i++}
      else if (c==='"') {quoted=false;closed=true}
      else cell+=c
    } else if (c===delimiter) {row.push(cell);cell='';closed=false}
    else if (c==='\r' || c==='\n') {if(c==='\r' && text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';closed=false}
    else if (c==='"' && !cell && !closed) quoted=true
    else if (closed && !/\s/.test(c)) throw new Error('CSV引号格式不正确，请重新导出CSV')
    else if (c==='"') throw new Error('CSV引号格式不正确，请重新导出CSV')
    else if (!closed) cell+=c
  }
  if (quoted) throw new Error('CSV存在未闭合的引号')
  if (cell || row.length) {row.push(cell);rows.push(row)}
  return rows
}
const normalizedHeader = (v: unknown) => String(v ?? '').replace(/^\uFEFF/,'').replace(/[（(]必填[）)]/g,'').replace(/\s/g,'').toUpperCase()
export function priceDraftsFromGrid(grid: unknown[][]): PriceDraft[] {
  const header=grid[0]?.map(normalizedHeader) ?? []
  const aliases=[['SKU','商品编码','内部SKU'],['A档价格','A档售价','价格一','A'],['B档价格','B档售价','价格二','B'],['C档价格','C档售价','价格三','C'],['D档价格','D档售价','价格四','D']]
  const columns=aliases.map(names=>header.flatMap((h,i)=>names.includes(h)?[i]:[]))
  if(columns.some(c=>c.length!==1)) throw new Error('首行必须包含唯一的SKU、A档价格、B档价格、C档价格、D档价格列')
  const indices=columns.map(c=>c[0]!), nameIndex=header.indexOf('商品名称'), result: PriceDraft[]=[], seen=new Set<string>()
  grid.slice(1).forEach((row,i)=>{
    if(row.every(v=>v==null || String(v).trim()===''))return
    const line=i+2, rawSku=row[indices[0]!]
    if(typeof rawSku!=='string' || !rawSku.trim() || rawSku.trim().length>30)throw new Error(`第${line}行：SKU须为文本，必填且最多30字；请将Excel的SKU列设为文本`)
    const sku=rawSku.trim(), key=sku.toLowerCase()
    if(seen.has(key))throw new Error(`第${line}行：SKU ${sku} 重复`)
    seen.add(key)
    const prices: Partial<Prices>={}
    priceTiers.forEach((tier,index)=>{
      const value=row[indices[index+1]!], text=value==null?'':String(value).trim()
      if(!text)return
      if(text==='清空') {if(tier==='A')throw new Error(`第${line}行：A档价格不能清空`);prices[tier]=null;return}
      if(!/^\d+(?:\.\d{1,2})?$/.test(text) || Number(text)<=0 || Number(text)>9999999999.99)throw new Error(`第${line}行：${tier}档价格须大于0、最多两位小数且不超过9999999999.99`)
      prices[tier]=Number(text)
    })
    if(!Object.keys(prices).length)throw new Error(`第${line}行：至少填写一档要修改的价格；空白表示保留原值`)
    result.push({sku,name:nameIndex>=0?String(row[nameIndex]??''):'',prices})
  })
  if(!result.length || result.length>500)throw new Error('每批需上传1至500个商品')
  return result
}
export async function readPriceImportFile(file: File): Promise<PriceDraft[]> {
  if(file.size>5*1024*1024)throw new Error('文件不能超过5MB，请分批上传')
  if(/\.xlsx$/i.test(file.name)) {
    const {default:readExcelFile}=await import('read-excel-file/universal')
    const sheets=await readExcelFile(file)
    return priceDraftsFromGrid(sheets[0]?.data ?? [])
  }
  if(!/\.csv$/i.test(file.name))throw new Error('请选择.xlsx或.csv文件；旧版.xls请另存为.xlsx')
  const bytes=new Uint8Array(await file.arrayBuffer())
  let text:string
  if(bytes[0]===255 && bytes[1]===254)text=new TextDecoder('utf-16le').decode(bytes)
  else {try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{text=new TextDecoder('gb18030').decode(bytes)}}
  return priceDraftsFromGrid(priceCsvGrid(text))
}
