/** 选品 → 采购 → 货盘库存 全链路说明（与各页面提示保持一致） */

export const PIPELINE_FULL =
  '产品开发 → 产品审核（核定计划量 + 生成 SKU + 预采购单）→ 采购主管分配 → 采购员编辑/确认预采购 → 产品主管核定实际数量 → 采购主管审核（同步商品主数据）→ 标记打款 → 明瑞物流查轨迹 → 入库发运（自动同步货盘库存）→ 定价 → 同步 OMS'

export const PIPELINE_DEV_ALERT =
  '产品开发 → 产品审核 → 预采购单 → 采购分配 → 采购确认 → 主管核定实际数量 → 采购审核 → 入库 → 货盘库存 → OMS'

export const PIPELINE_AUDIT_ALERT =
  '审核时重点核对链接、采购价、售价与尺寸；核定计划采购量并生成 SKU。审核通过后自动生成预采购单，交由采购主管分配。'

export const PIPELINE_AUDIT_FOOTER =
  '审核通过须核定计划采购数量并自动生成 SKU 与预采购单；采购主管分配采购员；采购员可修改预采购内容或取消；确认后生成正式采购单，由产品主管填写实际采购数量，再经采购主管审核；审核通过后写入商品主数据，默认未打款，可标记打款状态。'

export const PIPELINE_PURCHASE_MASTER =
  '（已废弃单独完善主数据步骤）商品主数据在采购主管审核通过后从预采购/正式采购单同步写入。'

export const PIPELINE_PURCHASE_PENDING =
  '采购员在「预采购单」中编辑供应商、单价等信息并确认；确认后由产品主管核定实际采购数量，再进入采购主管审核。'

export const PIPELINE_PURCHASE_ORDERS =
  '审核 → 预采购单 → 分配 → 采购确认 → 核定实际数量 → 采购审核（同步主数据）→ 标记打款 → 明瑞物流查轨迹 → 入库 → 货盘库存 → OMS'

export const PIPELINE_PURCHASE_ASSIGN =
  '产品审核通过后自动生成预采购单；采购主管在此分配给采购员。采购员在「预采购单」中编辑（含 SKU）并确认，或填写原因取消。'

export const PIPELINE_PRE_PO =
  '可修改 SKU、商品名、供应商、单价、国内运费等；确认后将生成正式采购单（实际采购数量由产品主管后续核定）。取消须填写原因。'

export const PIPELINE_PRICING_ALERT =
  '采购审核通过后采购成本与国内运费已写入；创建入库发运单时系统自动分摊海运费并同步 SKU 至货盘库存 → 待定价时设置对客户可见库存与售价 → 陪跑同步 OMS'

export const PIPELINE_INBOUND_CALLOUT =
  '打款后由明瑞线下订舱；在「明瑞物流」页查看海运轨迹。从中转仓可用库存创建发往海外仓的入库单，填写海运费分摊后，创建入库单将自动同步 SKU、入库数量与海运费至「货盘库存」；国内运费已在采购审核时同步。'
