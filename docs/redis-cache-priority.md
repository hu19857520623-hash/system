# Redis 首批基础资料缓存

沿用现有 Redis、认证、内存上限和故障回源策略。不涉及数据库结构变更。

|入口|数据|TTL|
|---|---|---|
|ERP GET /api/warehouses|仓库资料，按 type 分开|120–125 秒|
|ERP GET /api/warehouse-zones|库区资料，按 warehouseCode 分开；库位数量实时读取|120–125 秒|
|ERP 商品列表/详情的资料补充|SKU 名称、规格、分类、尺寸、图片路径等基础字段；价格成本仍实时读取|120–125 秒|
|ERP GET /api/announcements/oms，工作台公告|已发布且当前有效的公告，按渠道分开|30–35 秒|
|OMS GET /api/bootstrap 中的目的仓查询、独立目的仓接口|共用现有 OMS 目的仓缓存|30–35 秒|

仓库和库区写入成功后增加各自缓存组版本，写入失败不失效。库区的 _count/ locationCount 不进入缓存。

SKU 基础资料按当前商品 ID、基础字段和 updatedAt 的 SHA-256 生成版本键。商品资料或图片更新后新的查询使用新键，旧键自然过期；价格、成本、状态、测量结果、人员、供应商等仍从原查询返回。图片缓存保存原始路径，在响应时解析 COS URL，避免缓存临时签名链接。基础商品分页查询仍保留，主要减少重复图片关联查询，不缓存整个商品列表或货盘目录。

公告新增、修改、删除、定时发布成功后失效。每次返回缓存结果前检查 expiresAt，定时发布检查仍执行。公告管理列表、详情继续实时读取。OMS 的整个 bootstrap 响应不缓存，财务、订单、库存、用户权限等数据保持原查询。

缓存键沿用 `takealot:cache:v1:` 前缀，分别使用 `erp:warehouses:`、`erp:warehouse-zones:`、`erp:product-basics:`、`erp:announcements:`。目的仓键保持兼容。键按需生成，TTL -2 代表不存在/已过期。
