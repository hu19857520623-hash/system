import { renderPickListHtml } from '@erp/shared/outbound-pick-list'
import { OutboundService } from './outbound.service'

describe('拣货清单', () => {
  const order = { outboundNo: 'OB-1', warehouseCode: 'WH-1', items: [{ sku: 'SKU-1', productName: '商品', qty: 5, suggestedLocations: [{ locationCode: 'A01', pickQty: 2 }, { locationCode: 'B02', pickQty: 3 }] }] }
  it('逐库位显示取货数量，提供实拣和勾选位置', () => {
    const html = renderPickListHtml([order], '2026/11/16')
    expect(html).toContain('A01'); expect(html).toContain('B02')
    expect(html).toContain('拿 <b>2</b> 件'); expect(html).toContain('拿 <b>3</b> 件')
    expect(html).toContain('<th>实拣</th>'); expect(html).toContain('class="checkbox"')
  })
  it('历史清单使用实际分配，不显示已取消分配', () => {
    const html = renderPickListHtml([{ ...order, items: [{ ...order.items[0], pickAllocations: [{ locationCode: 'ACTUAL', qty: 5 }, { locationCode: 'OLD', qty: 5, status: 'cancelled' }] }] }])
    expect(html).toContain('ACTUAL'); expect(html).not.toContain('OLD'); expect(html).not.toContain('A01')
  })
  it('显示缺货并转义客户输入', () => {
    const html = renderPickListHtml([{ ...order, customerName: '<script>alert(1)</script>', items: [{ sku: '<img>', qty: 2 }] }])
    expect(html).toContain('缺 2 件库位库存'); expect(html).toContain('&lt;img&gt;')
    expect(html).not.toContain('<script>alert(1)')
  })
  it('下载使用同一明细及模板', async () => {
    const service = Object.create(OutboundService.prototype) as OutboundService
    jest.spyOn(service, 'detail').mockResolvedValue(order as any)
    const file = await service.buildPickListHtml(1)
    expect(file.content.toString()).toContain('B02')
    expect(file.mimeType).toContain('text/html')
  })
})
