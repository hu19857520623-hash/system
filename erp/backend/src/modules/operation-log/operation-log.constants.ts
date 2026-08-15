export const OPERATION_MODULE_LABELS: Record<string, string> = {
  purchase: '采购',
  product_audit: '产品审核',
  logistics_receipt: '物流收货',
  inbound: '入库',
  returns: '退件',
  inventory: '库存',
  product: '商品主数据',
  warehouse_location: '库位管理',
}

export const OPERATION_ACTION_LABELS: Record<string, string> = {
  create: '创建',
  update: '修改',
  delete: '删除',
  submit: '提交审核',
  approve: '审核通过',
  reject: '审核驳回',
  po_approve: '采购审核通过',
  po_reject: '采购审核驳回',
  finance_approve: '财务审核通过',
  finance_reject: '财务审核驳回',
  assign_purchaser: '分配采购员',
  confirm_master: '确认主数据生效',
  sync_from_po: '采购单同步主数据',
  freight_sync: '海运费回传同步',
  disable: '禁用商品',
  enable: '启用商品',
  upload_image: '上传图片',
  delete_image: '删除图片',
  arrival_scan: '到仓扫描',
  start_receive: '开始收货',
  qc: '收货清点',
  resolve_exception: '异常放行',
  putaway: '入库上架',
  adjust_qty: '调整数量',
  adjust_location: '调整库位',
  logistics_transfer: '中转仓库存转移',
  batch_create: '批量生成库位',
  zone_create: '创建分区',
  zone_update: '修改分区',
  oms_return_create: 'OMS 创建退件',
  oms_return_cancel: 'OMS 撤回退件',
  oms_return_resubmit: 'OMS 重新提交退件',
  receive: '确认收货',
  return_measure: '外箱测量',
  return_calc_fee: '退件算费',
  return_fee_template_create: '创建退件收费模板',
  return_fee_template_update: '更新退件收费模板',
  return_fee_template_delete: '删除退件收费模板',
  return_inspect: '提交质检',
  return_customer_decide: '客户决策',
  return_dispose: '确认销毁',
  process: '完成处理',
}

export function operationModuleLabel(module: string): string {
  return OPERATION_MODULE_LABELS[module] || module
}

export function operationActionLabel(action: string): string {
  return OPERATION_ACTION_LABELS[action] || action
}
