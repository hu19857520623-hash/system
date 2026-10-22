import { BadRequestException } from '@nestjs/common'
import type { ValidationError } from 'class-validator'
import { userFacingError } from '@erp/shared/user-facing-error'

const FIELD_LABELS: Record<string, string> = {
  reason: '处理原因', expectedCurrent: '当前数量', inboundItemId: '入库明细编号',
  receivedCartonCount: '实收箱数', differenceReason: '箱数差异原因', scanCode: '扫描码', increment: '每次件数',
  totalAmount: '海运费总额', expectedVersion: '单据版本', mode: '运输方式',
  sourceWarehouseCode: '始发中转仓', warehouseNo: '入仓号', productId: '商品档案编号', expectedQty: '发运数量',
  cartons: '外箱', boxSeq: '箱序号', boxCode: '箱号', grossWeightKg: '外箱毛重', freightLines: '费用明细',
  lengthCm: '长度', widthCm: '宽度', heightCm: '高度', weightKg: '重量', seaFreightPerUnit: '单件海运费',
  domesticFeePerUnit: '单件国内费用', costRmb: '商品成本', inboundQty: '费用分摊数量', draftNo: '草稿号', form: '草稿表单', inboundNo: '入库单号',
  poId: '采购单编号', poItemId: '采购明细编号', actualQty: '良品实收数量', damagedQty: '破损数量', qcStatus: '质检结论', qcRemark: '质检备注', receiptNo: '收货单号',
  username: '登录名', password: '密码', customerCode: '客户编码', customerId: '客户',
  warehouseCode: '仓库', locationCode: '库位', sku: 'SKU', quantity: '数量', qty: '数量',
  id: '记录编号', ids: '记录编号', items: '明细', stockLines: '上架明细', attachments: '附件',
  fileName: '文件名', contentBase64: '文件内容', clientRequestId: '操作标识',
  processResult: '处理结果', processRemark: '处理备注', orderNo: '订单号', returnNo: '退件单号',
  plannedQty: '计划数量', purchaserId: '采购员', supplierId: '供应商', supplierName: '供应商名称',
  unitPrice: '采购单价', domesticFreight: '国内运费', expectedArrival: '预计到货日期',
  productName: '商品名称', spec: '规格描述', productLengthCm: '产品长度', productWidthCm: '产品宽度', productHeightCm: '产品高度',
  packageLengthCm: '包装长度', packageWidthCm: '包装宽度', packageHeightCm: '包装高度',
  moq: '最小起订量', leadTimeDays: '交货天数', spareCartonQty: '备用纸箱数量', piecesPerCarton: '装箱件数',
  taxRate: '税率', invoiceTaxRate: '开票税率', unitTax: '单件税费', unitFreight: '单件运费', packageWeightKg: '包装重量',
  logoUnitFee: '标识单价', logoTotalFee: '标识总费用', cartonTotalPrice: '纸箱总费用', spareCartonUnitPrice: '备用纸箱单价',
}

/** Nest's default flattener prepends raw property paths even to custom Chinese messages. */
export function validationFeedback(errors: ValidationError[], context = ''): string[] {
  return errors.flatMap(error => {
    const row = /^\d+$/.test(error.property) ? `第 ${Number(error.property) + 1} 条明细：` : ''
    const nextContext = context + row
    const label = FIELD_LABELS[error.property] || '输入信息'
    const own = Object.entries(error.constraints || {}).map(([rule, message]) => {
      if (/[\u3400-\u9fff]/.test(message)) return nextContext + userFacingError(message, 400)
      const fallback = rule === 'isNotEmpty' || rule === 'isDefined' ? `请填写${label}`
        : rule === 'isInt' ? `${label}须为有效整数`
          : rule === 'isString' ? `${label}须为文字内容`
            : rule === 'isArray' || rule === 'arrayMinSize' ? `请填写有效的${label}`
              : rule === 'maxLength' ? `${label}内容过长，请核对后重试`
                : `${label}格式或取值无效，请核对后重试`
      return nextContext + fallback
    })
    return [...own, ...validationFeedback(error.children || [], nextContext)]
  })
}

export function chineseValidationException(errors: ValidationError[]) {
  return new BadRequestException([...new Set(validationFeedback(errors))])
}
