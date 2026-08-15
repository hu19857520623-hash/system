/**
 * 从「客户管理」Excel 导入获客线索到 MySQL
 * 用法: npx ts-node prisma/import-leads-xlsx.ts [xlsx路径]
 */
import * as XLSX from 'xlsx'
import { PrismaClient } from '@prisma/client'

const DEFAULT_XLSX =
  'd:\\wx\\xwechat_files\\wxid_a0xp3budymkt12_1059\\msg\\file\\2026-06\\客户管理(1).xlsx'

const SOURCE_MAP: Record<string, string> = {
  小红书: 'xiaohongshu',
  抖音: 'douyin',
  视频号: 'wechat_video',
  公众号: 'official_account',
  官网: 'website',
  展会: 'expo',
  推荐: 'referral',
}

function mapSource(ch: string): string {
  return SOURCE_MAP[ch.trim()] || 'other'
}

function mapStatus(s: string): string {
  s = (s || '').trim()
  if (s.includes('成交')) return 'deal'
  if (s.includes('无效')) return 'lost'
  if (s.includes('跟进')) return 'following'
  return 'new'
}

function parseDate(s: unknown): Date | undefined {
  if (!s) return undefined
  const str = String(s).trim()
  const m = str.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  if (!m) return undefined
  const [, y, mo, d] = m
  return new Date(Number(y), Number(mo) - 1, Number(d))
}

function cellStr(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

function buildRemark(parts: Record<string, string>): string {
  return Object.entries(parts)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`)
    .join(' | ')
}

function extractNameKey(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  const m = s.match(/^([^(（,，]+)/)
  return (m ? m[1] : s).trim()
}

function trunc(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max)
}

function normalizeContact(wechat: string, contact: string) {
  let contactName = wechat || ''
  let contactPhone = contact || ''
  if (contactPhone && contactPhone.length > 30) {
    if (!contactName) contactName = contactPhone
    contactPhone = ''
  }
  return {
    contactName: contactName ? trunc(contactName, 50) : null,
    contactPhone: contactPhone ? trunc(contactPhone, 30) : null,
  }
}

async function main() {
  const xlsxPath = process.argv[2] || DEFAULT_XLSX
  console.log(`读取 Excel: ${xlsxPath}`)

  const wb = XLSX.readFile(xlsxPath, { cellDates: true })
  const ws = wb.Sheets['订单跟进明细']
  if (!ws) throw new Error('未找到工作表「订单跟进明细」')

  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: '',
    raw: false,
  })

  const prisma = new PrismaClient()
  const users = await prisma.sysUser.findMany({ select: { id: true, username: true, realName: true } })

  function resolveAssignee(sales: string, sales2: string): bigint | undefined {
    const candidates = [sales2, sales].map(extractNameKey).filter(Boolean)
    for (const key of candidates) {
      const hit = users.find(
        (u) =>
          u.realName === key ||
          u.realName.includes(key) ||
          key.includes(u.realName) ||
          (key.toLowerCase().includes('kiki') && u.username === 'chenqi') ||
          (key.includes('林') && u.username === 'linxinyi'),
      )
      if (hit) return hit.id
    }
    const fallback = users.find((u) => u.username === 'linxinyi')
    return fallback?.id
  }

  // 清除旧导入（保留 seed 演示 LD-2026-*）
  const old = await prisma.lead.findMany({
    where: { leadNo: { startsWith: 'LD-XHS-' } },
    select: { id: true },
  })
  if (old.length) {
    const ids = old.map((l) => l.id)
    await prisma.leadFollowUp.deleteMany({ where: { leadId: { in: ids } } })
    await prisma.leadDeal.deleteMany({ where: { leadId: { in: ids } } })
    await prisma.lead.deleteMany({ where: { id: { in: ids } } })
    console.log(`已清除旧导入 ${old.length} 条`)
  }

  let seq = 0
  let imported = 0
  let followCount = 0
  let dealCount = 0

  for (let i = 2; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.every((c) => !cellStr(c))) continue

    const r = row.map(cellStr)
    while (r.length < 17) r.push('')

    const [
      name,
      wechat,
      srcPerson,
      channel,
      sales,
      contact,
      ,
      leadType,
      status,
      consultTime,
      frontend,
      remark,
      dealDate,
      shopType,
      sales2,
      salesInfo,
      dealTime,
    ] = r

    if (!name && !wechat && !contact) continue

    seq++
    const leadNo = `LD-XHS-${String(seq).padStart(4, '0')}`
    const companyName = trunc(name || wechat || contact, 200)
    const { contactName, contactPhone } = normalizeContact(wechat, contact)
    const fullRemark = buildRemark({
      留资: leadType,
      前端: frontend,
      备注: remark,
      获客: srcPerson,
      对接: sales,
      再对接: sales2,
      销售情况: salesInfo,
    })
    const statusKey = mapStatus(status)
    const createdAt = parseDate(consultTime) || new Date()
    const assigneeId = resolveAssignee(sales, sales2)

    const lead = await prisma.lead.create({
      data: {
        leadNo,
        companyName,
        contactName,
        contactPhone,
        source: trunc(mapSource(channel), 30),
        status: statusKey,
        remark: fullRemark || null,
        assigneeId,
        createdAt,
      },
    })
    imported++

    const fuContent = salesInfo || remark || status
    if (fuContent) {
      await prisma.leadFollowUp.create({
        data: { leadId: lead.id, followType: 'wechat', content: fuContent },
      })
      followCount++
    }

    if (statusKey === 'deal') {
      const dd = parseDate(dealDate) || parseDate(dealTime) || parseDate(consultTime) || new Date()
      await prisma.leadDeal.create({
        data: {
          leadId: lead.id,
          dealNo: `DEAL-XHS-${String(dealCount + 1).padStart(4, '0')}`,
          dealDate: dd,
          productDesc: shopType || null,
          status: 'confirmed',
        },
      })
      dealCount++
    }

    if (imported % 500 === 0) console.log(`  已导入 ${imported} 条...`)
  }

  console.log(`\n导入完成:`)
  console.log(`  线索: ${imported}`)
  console.log(`  跟进记录: ${followCount}`)
  console.log(`  成交记录: ${dealCount}`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
