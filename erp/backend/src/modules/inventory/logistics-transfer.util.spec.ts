import { BadRequestException } from '@nestjs/common'
import {
  assertLogisticsWarehouse,
  parseLogisticsTransferBody,
  transferLogRemarks,
} from './logistics-transfer.util'

describe('logistics-transfer.util', () => {
  it('parses a Shenzhen to Yiwu transfer', () => {
    expect(parseLogisticsTransferBody({
      sku: ' TKL-HX6 ',
      fromWarehouseCode: 'LW-SZ-01',
      toWarehouseCode: 'LW-YW-01',
      qty: 40,
      remark: '集货',
    })).toEqual({
      sku: 'TKL-HX6',
      fromWarehouseCode: 'LW-SZ-01',
      toWarehouseCode: 'LW-YW-01',
      qty: 40,
      remark: '集货',
    })
  })

  it('rejects the same warehouse and non-integer qty', () => {
    expect(() => parseLogisticsTransferBody({
      sku: 'A',
      fromWarehouseCode: 'LW-SZ-01',
      toWarehouseCode: 'LW-SZ-01',
      qty: 1,
    })).toThrow(BadRequestException)

    expect(() => parseLogisticsTransferBody({
      sku: 'A',
      fromWarehouseCode: 'LW-SZ-01',
      toWarehouseCode: 'LW-YW-01',
      qty: 1.5,
    })).toThrow(BadRequestException)
  })

  it('requires active logistics warehouses', () => {
    expect(() => assertLogisticsWarehouse(null, '调出')).toThrow(/物流中转仓/)
    expect(() => assertLogisticsWarehouse({
      warehouseCode: 'WMS-JHB-01',
      warehouseName: 'JHB',
      warehouseType: 'wms',
      status: 1,
    }, '调入')).toThrow(/物流中转仓/)
    expect(() => assertLogisticsWarehouse({
      warehouseCode: 'LW-YW-01',
      warehouseName: '义乌',
      warehouseType: 'logistics',
      status: 0,
    }, '调入')).toThrow(/停用/)
  })

  it('builds paired log remarks', () => {
    expect(transferLogRemarks('深圳集运物流仓', '义乌集运物流仓', '集货')).toEqual({
      outRemark: '调拨至 义乌集运物流仓 · 集货',
      inRemark: '从 深圳集运物流仓 调入 · 集货',
    })
  })
})
