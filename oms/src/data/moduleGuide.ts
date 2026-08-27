/** 各模块功能说明 — 参考行业 OMS 标准能力，适配 Takealot 海外仓场景 */

export interface ModuleGuide {
  title: string
  desc: string
  features: string[]
  status?: 'ready' | 'partial' | 'planned'
}

export const MODULE_GUIDES: Record<string, ModuleGuide> = {
  dashboard: {
    title: '首页看板',
    desc: '一屏掌握订单、库存、异常与费用概况，快速跳转待处理事项。',
    features: ['今日订单与 GMV', '发货进度漏斗', '异常中心汇总', '库存预警与费用概览'],
    status: 'ready',
  },
  orders: {
    title: '订单管理',
    desc: '平台同步与手工订单统一管理，支持状态筛选、高级筛选与异常处理。',
    features: [
      '状态 Tab：全部 / 待审核 / 待发货 / 发货中 / 已发货 / 异常',
      '高级筛选：平台（Takealot / 手工 / Shopify）、店铺、仓库、国家、物流',
      '批量操作：导出、重新同步、取消、重新推送发货',
      '订单抽屉：商品明细、物流轨迹、费用明细、操作日志',
    ],
    status: 'ready',
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
    desc: '参考「产品管理」：SKU 主数据、申报信息、规格尺寸、证书与绑码状态。',
    features: [
      '筛选：含电池 / 上传证书 / 箱规 / 品类 / SKU / 申报价值 / 重量',
      '状态 Tab：全部 / 可用 / 草稿 / 废弃 / 审核中',
      '列表：申报品名、申报价值、长宽高、重量、证书状态',
      '操作：创建产品、打印条码、批量、导入/导出、编辑、复制',
    ],
    status: 'partial',
  },
  codes: {
    title: '编码与绑定',
    desc: '平台商品条码 ↔ 仓库 SKU 映射，以及客户自定义码、箱唛等辅助编码。',
    features: [
      '平台绑定：Takealot 商品条码、listing、组合品',
      'Tab：待绑定 / 已绑定 / 条码不一致 / 待审核',
      '同步 Takealot 商品、导入、打印标签',
      '辅助编码：客户码 / 箱唛、版本号与变更申请',
    ],
    status: 'ready',
  },
  outbound: {
    title: '预约发货',
    desc: '文档流程：Takealot 预约并下载外箱标/标签/清单/预约单 → OMS 下发出库单上传文件 → 海外仓回传单号。',
    features: [
      'Takealot 入仓：先在 Takealot 预约，再在 OMS 创建出库单',
      '上传 Takealot 下载的外箱标、SKU 标签、清单、预约单',
      '货盘分销 / 平台订单 / 手工录入（Makro、Temu）',
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
    desc: '已合并至「订单与出库」：出库后物流单号、轨迹与平台仓签收单（POD）在同一页查看与回传。',
    features: ['按出库单/运单查轨迹', '回传平台仓签收单（POD）', '待回传签收单筛选', '与 WMS 出库回传联动'],
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
      '按月汇总：仓储 / 操作 / 物流',
      '费用明细：预扣标记、关联单号',
      '账户余额与充值',
      '报表中心：费用占比与趋势分析',
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
