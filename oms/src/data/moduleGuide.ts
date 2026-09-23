/** 各模块功能说明 — 以当前 OMS 页面为准（非行业对标清单）；status 表示本仓库已实现程度 */

export interface ModuleGuide {
  title: string
  desc: string
  features: string[]
  status?: 'ready' | 'partial' | 'planned'
}

export const MODULE_GUIDES: Record<string, ModuleGuide> = {
  dashboard: {
    title: '首页看板',
    desc: '欢迎页与快捷入口：余额、今日订单、待办计数，跳转入库/出库/库存/账单；非 BI 报表页。',
    features: [
      '横幅：账户余额、今日订单数、异常订单数',
      '常用功能快捷入口、待办（在途入库 / 待发货出库 / 未读消息）',
      '最近入库 / 最近出库、系统公告（只读）',
      '未提供：GMV 汇总、发货进度漏斗、渠道分析',
    ],
    status: 'partial',
  },
  orders: {
    title: '订单与出库',
    desc: 'OMS 出库履约与费用查看；数据来自出库单与本地履约记录，非 Shopify/Takealot 订单自动同步中心。',
    features: [
      '列表 Tab 与筛选：单号、平台（Takealot / 其他）、仓库、SKU 等',
      '详情抽屉：概要、费用明细、异常备注保存',
      '回传运单 / POD（Takealot 等平台仓场景）',
      '未提供：Shopify 店铺订单同步、批量重新同步 / 取消 / 重新推仓',
    ],
    status: 'partial',
  },
  ordersImport: {
    title: '批量导入订单',
    desc: '参考行业 OMS：Excel 模板批量建单，支持上传面单 PDF、箱标等附件。',
    features: ['xls 模板导入', '面单/标签附件上传', 'PDF 自动裁剪（USPS/UPS/FedEx 等）', '截单时间与承运商规则提示'],
    status: 'planned',
  },
  catalog: {
    title: '货盘选品 / 产品目录',
    desc: '浏览平台货盘或已上架商品目录，选品后同步 ERP 分销记录。',
    features: ['按品类浏览', 'SKU / 名称搜索', '可售库存与价格展示', '加入我的货盘'],
    status: 'ready',
  },
  products: {
    title: '我的商品',
    desc: 'ERP 同步的 SKU 主数据：申报信息、规格尺寸与绑码状态；新建产品走 ERP 接口。',
    features: [
      '筛选：含电池 / 箱规 / SKU / 申报价值 / 重量',
      '状态 Tab：全部 / 可用 / 草稿 / 废弃（历史本地状态仍可在「全部」查看）',
      '列表：申报品名、申报价值、长宽高、重量',
      '操作：创建产品（同步 ERP）、打印条码、导出、复制新建',
    ],
    status: 'partial',
  },
  codes: {
    title: '990码绑定',
    desc: 'Takealot 990 条码按客户绑定到仓库 SKU，用于出库识别标签。',
    features: [
      '绑定 990 条码到仓库 SKU，支持组合品',
      '货盘分销后同一 SKU 在每个客户下绑定各自的 990，互不共用',
      '导入绑定、出库时按当前客户的 990 码识别商品',
    ],
    status: 'ready',
  },
  outbound: {
    title: '预约发货',
    desc: '文档流程：Takealot 预约并下载外箱标/标签/清单/预约单 → OMS 下发出库单上传文件 → 海外仓回传单号。',
    features: [
      'Takealot 入仓：先在 Takealot 预约，再在 OMS 创建出库单',
      '上传 Takealot 下载的外箱标、SKU 标签、清单、预约单',
      '货盘分销 / 手工录入 / Takealot 入仓',
      '海外仓发货后物流单号与签收单在「订单与出库」查看',
    ],
    status: 'partial',
  },
  inbound: {
    title: '预约入库',
    desc: '参考 Buffalo 海外仓 WMS：创建入库预报单，填写目的仓/预计到货/货品明细，提交后打印箱唛与 SKU 标签。',
    features: [
      '状态：草稿 / 在途 / 收货中 / 收货完成 / 上架完成 / 异常',
      '按箱录入 SKU，支持批量上传',
      '提交后可打印箱唛、SKU 标签贴于外箱',
      '仓库收货前可更新跟踪号或取消预约',
    ],
    status: 'partial',
  },
  inventory: {
    title: '库存查询',
    desc: '分池查询自有库存与货盘库存，多维度数量视图，数据以仓库实物为准。',
    features: [
      '库存池 Tab：全部 / 自有库存 / 货盘库存',
      '可用 / 锁定 / 在途 / 待上架 / 待出库 / 不良品',
      'Tab：全部 / 低库存 / 断货风险 / 有锁定',
      '混合客户可同时查看双池库存',
    ],
    status: 'ready',
  },
  inventoryVolume: {
    title: '产品体积查询',
    desc: '参考 OMS 仓容管理：按 SKU 汇总占用体积，辅助仓储费核算。',
    features: ['按仓库筛选', '可售/待出库/不良品体积拆分', '导出明细'],
    status: 'planned',
  },
  shipping: {
    title: '预约发货',
    desc: '已合并至「预约发货」模块，/shipping 自动跳转。',
    features: ['请使用仓储履约预约中心 → 预约发货'],
    status: 'ready',
  },
  logistics: {
    title: '物流与签收',
    desc: '已合并至「订单与出库」：出库后物流单号与平台仓签收单（POD）在同一页查看与回传。',
    features: ['海外仓发货后回传运单号', '回传平台仓签收单（POD）', '待回传签收单筛选'],
    status: 'partial',
  },
  returns: {
    title: '退件管理',
    desc: '参考「退货管理」：建立退件、批量导入、认领、处理不良品与结果查看。',
    features: [
      '退件单：RMA、跟踪号、退件原因',
      '处理方式：重新上架 / 退回 / 销毁',
      '状态：待确认 / 在途 / 已到仓 / 已完成 / 异常',
      '批量导入退件预约单（CSV 模板）',
      '（规划）退件认领',
    ],
    status: 'partial',
  },
  billing: {
    title: '费用账单',
    desc: '预扣款模式：出库按 SKU 尺寸试算并扣减余额，仓租按模板日扣。',
    features: [
      '按月汇总：仓储 / 操作 / 物流 / 换标（来自费用流水）',
      '费用明细：预扣标记、关联单号',
      '账户余额与充值（ERP）',
      '不含客户档案中的静态「预算已用」进度',
    ],
    status: 'ready',
  },
  priceTemplate: {
    title: '价格模板',
    desc: '系统管理 · 按收货地区（JHB/CPT/DBN）分别维护出库价格，客户可分区绑定模板。',
    features: [
      '三区独立模板：操作费 + 物流费 + 自提费',
      '账号管理：为客户分别绑定 JHB / CPT / DBN 模板',
      '出库试算：按目的地区自动选用对应模板',
      '仓租模板：体积或件数日计费、免租期',
    ],
    status: 'ready',
  },
  regionTemplates: {
    title: '地区模板',
    desc: '系统管理 · 配置发往各地区时默认使用的配送方式（卡派 / 快递）。',
    features: [
      'JHB / CPT / DBN 三地区独立配置',
      '每条规则指定卡派或快递',
      '预约发货选择地区后自动套用',
      'Takealot 入仓按目的仓自动匹配',
    ],
    status: 'ready',
  },
  recharge: {
    title: '账户充值',
    desc: '参考「费用流水」入款：充值账户余额，用于后续自动扣费。',
    features: ['在线充值', '充值记录', '余额与冻结金额展示'],
    status: 'ready',
  },
  billingFlow: {
    title: '费用流水',
    desc: '参考 OMS 流水账：逐笔扣款/入款明细，可追溯至订单与费用类型。',
    features: ['扣款 / 入款筛选', '账户余额变动', '关联订单号与费用类型', '导出'],
    status: 'planned',
  },
  reports: {
    title: '报表中心',
    desc: '费用管理 · 订单趋势、库存周转与费用分析。',
    features: ['订单量 / GMV 趋势', '库存周转天数', '渠道妥投率', '费用占比'],
    status: 'planned',
  },
  members: {
    title: '账号管理',
    desc: '系统管理员维护电商/货盘/混合客户账号，分配模块权限，支持货盘→混合升级。',
    features: [
      '客户账号列表：类型（电商/货盘/混合）、联系人、状态',
      '按模块勾选分配权限（订单/货盘/库存等）',
      '套用电商/货盘/混合默认权限模板',
      '同模块内维护：价格模板、地区模板（内定费率）',
      '货盘客户一键升级为混合客户，历史货盘库存保留',
      '一键禁用违规或欠费客户账号',
    ],
    status: 'ready',
  },
}
