# Takealot ERP API 接口文档

> **与代码同步**：`backend/src/modules/**/*.controller.ts`  
> **工作台模块**：`/dashboard` 现为 **4** 个接口（含 `trends`、`notifications`）  
> **Base URL**：`http://localhost:3000/api`  
> **前端封装**：`frontend/src/api/client.js`

---

## 通用约定

### 鉴权

| 范围 | 说明 |
|------|------|
| 公开 | 仅 `POST /auth/login` |
| JWT | 其余接口 Header：`Authorization: Bearer <token>` |
| 管理员 | `POST/PUT/DELETE /users` 需 `roleCode = admin` |

### 响应格式

```json
{ "code": 0, "message": "ok", "data": { ... } }
```

失败时 `code !== 0`，`message` 为错误说明。部分下载接口直接返回文件流（CSV / HTML），无 JSON 包装。

### 分页（多数列表接口）

| Query | 类型 | 默认 | 说明 |
|-------|------|------|------|
| `page` | number | 1 | 页码 |
| `pageSize` | number | 20 | 每页条数，最大 200 |
| `keyword` | string | — | 关键词（各模块字段不同） |

```json
{ "items": [], "total": 100, "page": 1, "pageSize": 20 }
```

BigInt 主键在 JSON 中序列化为 `number`。

### 文件下载类接口

| 接口 | Content-Type | 说明 |
|------|--------------|------|
| `GET /products/by-sku/:sku/label` | text/html | SKU 标签 HTML |
| `GET /inbound/:id/labels/sku` | text/html | 入库单 SKU 标签 |
| `GET /inbound/:id/labels/outer` | text/html | 外箱标 HTML |
| `GET /async-io/:id/download` | text/csv | 导出任务结果 |

---

## 1. 鉴权 `/auth`（2）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/auth/login` | 否 | 登录 |
| GET | `/auth/profile` | JWT | 当前用户信息与权限 |

**POST `/auth/login`**

```json
{ "username": "admin", "password": "123456" }
```

**Response.data**

```json
{
  "token": "eyJ...",
  "user": { "id": 1, "username": "admin", "realName": "系统管理员", "roleCode": "admin" }
}
```

---

## 2. 用户 `/users`（6）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/users/roles` | JWT | 角色列表 |
| GET | `/users` | JWT | 用户列表 |
| GET | `/users/:id` | JWT | 用户详情 |
| POST | `/users` | **admin** | 创建用户 |
| PUT | `/users/:id` | **admin** | 更新用户 |
| DELETE | `/users/:id` | **admin** | 删除用户 |

**GET `/users` Query：** `page`, `pageSize`, `keyword`, `roleCode`

---

## 3. 工作台 `/dashboard`（4）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/dashboard/stats` | 经营统计 KPI |
| GET | `/dashboard/trends` | 近 N 日入库/出库/同步失败趋势 |
| GET | `/dashboard/announcements` | 最新 ERP 公告（最多 10 条） |
| GET | `/dashboard/notifications` | 跨模块待办汇总与导航角标 |

### `GET /dashboard/stats`

无 Query。返回当前经营快照：

| 字段 | 类型 | 说明 |
|------|------|------|
| `products` | number | 商品 SKU 总数 |
| `suppliers` | number | 状态启用（`status=1`）的供应商数 |
| `leads` | number | 线索总数 |
| `pendingPo` | number | 待审采购单（`pending_po_audit` / `pending_finance`） |
| `pendingAudit` | number | 待审选品（`product_dev.status=submitted`） |
| `syncFailed` | number | 同步失败条数（已排除历史 WMS inbound 推送噪声） |
| `inventoryAvailable` | number | 可用库存数量合计（`inventory.availableQty` 求和） |

### `GET /dashboard/trends`

| Query | 类型 | 默认 | 说明 |
|-------|------|------|------|
| `days` | number | `7` | 回溯天数；非法值回退 `7`；最终钳制到 **1–30** |

按 **UTC 自然日** 分桶，统计每日**中转仓收货**（`logistics_receipt.received_at`）：

```json
{
  "days": 7,
  "series": [
    { "date": "07-21", "receipts": 2, "receivedQty": 120, "damagedQty": 1 },
    { "date": "07-22", "receipts": 0, "receivedQty": 0, "damagedQty": 0 }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `date` | `MM-DD`（UTC） |
| `receipts` | 当日中转仓收货单数 |
| `receivedQty` | 当日实收件数合计 |
| `damagedQty` | 当日残次件数合计 |

### `GET /dashboard/announcements`

返回 `status=published` 且 `targetChannel=erp` 的公告，按置顶、`id` 倒序，最多 10 条。字段含 `id`、`title`、`category`、`content`、`targetChannel`、`publishedAt`、`isPinned` 等。

### `GET /dashboard/notifications`

聚合各业务节点待办，供工作台待办列表与侧栏/顶栏角标使用：

```json
{
  "total": 12,
  "items": [
    {
      "key": "purchase",
      "screenId": "purchase",
      "title": "采购待审核",
      "count": 3,
      "route": "/purchase",
      "tone": "warn"
    }
  ],
  "badges": {
    "purchase": 3,
    "inbound_receipt": 2
  }
}
```

| 字段 | 说明 |
|------|------|
| `total` | `items` 中 `count` 合计 |
| `items` | 待办条目；`count=0` 的条目仍可能返回，由前端过滤 |
| `items[].tone` | `warn` / `err` / `info` |
| `badges` | 以 `key` 为键的角标字典；额外含 `inbound_receipt`（已到仓 + 收货中） |

主要 `key`：`leads_follow`、`product_audit`、`purchase`、`logistics_wh`、`inbound_in_transit`、`inbound_arrived`、`inbound_receiving`（仅有收货中时）、`inbound_putaway`、`outbound`、`inbound_exception`（仅有异常时）、`pricing`、`sync`。

**前端封装：** `dashboardApi.stats()` / `trends(days)` / `announcements()` / `notifications()`

---

## 4. 线索 `/leads`（9）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/leads/report` | 获客报表汇总 |
| GET | `/leads` | 线索列表 |
| POST | `/leads/import` | CSV 批量导入 |
| GET | `/leads/:id` | 详情（含跟进、成交） |
| POST | `/leads` | 新建 |
| PUT | `/leads/:id` | 更新 |
| POST | `/leads/:id/follow-up` | 添加跟进 |
| POST | `/leads/:id/deal` | 登记成交 |
| DELETE | `/leads/:id` | 删除 |

**GET `/leads` Query：** `page`, `pageSize`, `keyword`, `status`（`new`/`following`/`deal`/`lost`）, `assigneeId`

**POST `/leads/import` Body**

```json
{ "content": "客户名称,联系人,电话\n开普敦贸易,John,+27-82-1234567" }
```

**Response.data：** `{ "imported": 1, "failed": 0 }`

---

## 5. 商品 `/products`（6）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/products` | 列表 |
| GET | `/products/by-sku/:sku/label` | 下载 SKU 标签 HTML |
| GET | `/products/:id` | 详情 |
| POST | `/products` | 创建 |
| PUT | `/products/:id` | 更新 |
| DELETE | `/products/:id` | 删除 |

**GET Query：** `page`, `pageSize`, `keyword`, `status`（`active`/`pending`/`inactive`）

---

## 6. 选品 `/product-dev`（8）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/product-dev` | 列表 |
| GET | `/product-dev/:id` | 详情 |
| POST | `/product-dev` | 新建 |
| PUT | `/product-dev/:id` | 更新 |
| POST | `/product-dev/:id/submit` | 提交审核 |
| POST | `/product-dev/:id/approve` | 审核通过 |
| POST | `/product-dev/:id/reject` | 驳回 |
| DELETE | `/product-dev/:id` | 删除 |

**GET Query：** `page`, `pageSize`, `keyword`, `status`（`draft`/`submitted`/`approved`/`rejected`）

**POST `/product-dev/:id/approve` Body：** `{ "purchaseQty": 2000, "remark": "审核意见" }`

- `purchaseQty` 为**计划采购量**（参考），采购员创建采购单时可填不同的实际 `quantity`

---

## 7. 供应商 `/suppliers`（5）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/suppliers` | 列表 |
| GET | `/suppliers/:id` | 详情 |
| POST | `/suppliers` | 创建 |
| PUT | `/suppliers/:id` | 更新 |
| DELETE | `/suppliers/:id` | 删除 |

**GET Query：** `page`, `pageSize`, `keyword`

---

## 8. 采购 `/purchase-orders`（8）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/purchase-orders` | 列表 |
| GET | `/purchase-orders/:id` | 详情（含明细） |
| POST | `/purchase-orders` | 创建 |
| POST | `/purchase-orders/:id/approve` | 主管审核通过 |
| POST | `/purchase-orders/:id/reject-po-audit` | 主管驳回 |
| POST | `/purchase-orders/:id/finance-approve` | 财务审核通过 |
| POST | `/purchase-orders/:id/reject-finance` | 财务驳回 |
| DELETE | `/purchase-orders/:id` | 删除 |

**GET Query：** `page`, `pageSize`, `keyword`, `status`

**POST `/purchase-orders` Body：** `{ "supplierId", "warehouseCode", "domesticFreight?", "items": [{ "sku", "productId", "productName", "plannedQty?", "quantity", "unitPrice", "remark?" }] }`

- `plannedQty`：产品主管核定的计划采购量（参考，可与 `quantity` 不同）
- `quantity` / `unitPrice`：本次实际采购数量与单价
- `domesticFreight`：国内运费总额，按数量分摊到各行；财务审核通过后写入货盘定价的「国内费用/件」

**POST `/purchase-orders/:id/finance-approve`：** 财务审核通过后自动同步：
- 商品主数据 `costRmb` ← 采购明细 `unitPrice`
- 货盘定价 `purchaseQty`、`costRmb`、`domesticFee`（国内运费/件）、`poNo`（若无记录则创建，状态 `waiting_freight`）

---

## 9. 入库 `/inbound`（14）

> **架构说明：** 入库在 ERP 内部闭环（创建 → 收货 → 清点 → 上架 → 库存），不再推送外部 WMS。
> 响应体含 `displayStatus` 字段，将旧态 `pending_push` / `push_failed` / `pushed` 归一为 `pending_receipt`，`confirmed` 归一为 `completed`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/inbound/drafts` | 草稿列表（当前用户） |
| POST | `/inbound/drafts` | 保存草稿 |
| DELETE | `/inbound/drafts/:draftNo` | 删除草稿 |
| POST | `/inbound/attachments` | 上传附件（base64） |
| GET | `/inbound` | 入库单列表 |
| GET | `/inbound/:id` | 详情 |
| GET | `/inbound/:id/labels/sku` | SKU 标签 HTML（Query: `sku` 可选） |
| GET | `/inbound/:id/labels/outer` | 外箱标 HTML |
| POST | `/inbound` | 创建入库单（初始状态 `pending_receipt`） |
| POST | `/inbound/:id/start-receive` | 开始收货 → `receiving` |
| POST | `/inbound/:id/qc` | 清点/质检 → `pending_putaway` 或 `exception` |
| POST | `/inbound/:id/resolve-exception` | 异常放行 → `pending_putaway` |
| POST | `/inbound/:id/putaway` | 上架入库 → `completed`（写库存） |
| POST | `/inbound/:id/confirm` | **已废弃** 一步确认（兼容旧客户端，内部走 qc + 默认待上架区 putaway） |

**状态流转：** `pending_receipt` → `receiving` → `pending_putaway` → `completed`（异常时经 `exception` 放行）

**GET `/inbound` Query：** `page`, `pageSize`, `keyword`, `status`

**POST `/inbound/drafts` Body**

```json
{
  "draftNo": "DRF-IN-123456",
  "form": { "logisticsWhCode": "LW-SZ-01", "lines": [] }
}
```

**POST `/inbound/attachments` Body**

```json
{
  "draftNo": "DRF-IN-123456",
  "inboundId": 1,
  "fileName": "packing-list.pdf",
  "contentBase64": "..."
}
```

**POST `/inbound` Body**

```json
{
  "inboundNo": "IN-20260626",
  "poId": 1,
  "warehouseCode": "WMS-JHB-01",
  "remark": "入仓:WH-001",
  "items": [
    { "productId": 1, "sku": "TK-99001", "productName": "ANC 耳机", "expectedQty": 100 }
  ]
}
```

**POST `/inbound/:id/qc` Body**

```json
{
  "acceptDiff": false,
  "items": [
    { "id": 1, "sku": "TK-99001", "actualQty": 100, "qcStatus": "pass", "qcRemark": "" }
  ]
}
```

**POST `/inbound/:id/putaway` Body**

```json
{
  "items": [
    { "inboundItemId": 1, "allocations": [{ "locationId": 10, "qty": 100 }] }
  ]
}
```

---

## 10. 出库 `/outbound`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/outbound` | 出库单列表 |
| GET | `/outbound/status-counts` | 状态计数 |
| GET | `/outbound/export` | CSV 导出 |
| GET | `/outbound/:id` | 详情 |
| POST | `/outbound` | 创建出库单 |
| GET | `/outbound/:id/attachment` | 下载 CPT 附件 |
| POST | `/outbound/:id/attachment` | 上传 CPT 附件（base64） |
| POST | `/outbound/:id/confirm-relabel` | 确认换标（扫旧码；可 `allowSkipScan`） |
| GET | `/outbound/:id/pick-list` | 拣货清单 HTML |
| POST | `/outbound/:id/pick` | 拣货（`pickSource`: `pda`\|`pick_list`） |
| POST | `/outbound/:id/pack` | 复核打包（`reviewSource`: `pda`\|`pick_list`） |
| POST | `/outbound/:id/appointment` | 更新预约状态/送仓日期 |
| POST | `/outbound/:id/ship` | 发货（扣库存 + 自动 ERP 计费） |
| POST | `/outbound/:id/deliver` | 确认送达（可选 `podCode`） |
| POST | `/outbound/:id/cancel` | 取消 |
| POST | `/outbound/assign-picker` | 批量分配拣货员 |
| POST | `/outbound/:id/problem` | 标记/解除异常 |

**状态流转：** `pending_pick` → `reviewing` →（需换标时）`pending_relabel` → `packed` → `shipped` → `delivered`（可 `exception` / `cancelled`）

**GET Query：** `page`, `pageSize`, `keyword`, `status`, `warehouseCode`, `customerId`, `destType`, `sku`, `createdFrom`, `createdTo`, `appointmentFrom`, `appointmentTo`, `appointmentStatus`, `logisticsProduct`, `carrier`, `pickerId`, `needsRelabel`, `isProblem`, `batchNo`, `platform`

**SOP P0 字段：** `appointmentDate`（预约送仓日）、`pickSource` / `reviewSource`、明细 `oldBarcode`/`newBarcode`、`podCode`

**SOP P1 字段：** `relabelPrintCount`（出库换标计费件数，发运时按此计费）；入库 `labelPrintCount`（标签打印累计件数，下载 SKU/外箱标时累加）

**POST `/outbound` Body 示例**

```json
{
  "customerId": 1,
  "warehouseCode": "WMS-JHB-01",
  "destType": "fba",
  "needsRelabel": true,
  "appointmentStatus": "scheduled",
  "appointmentDate": "2026-07-30",
  "remark": "",
  "items": [{ "productId": 1, "sku": "TK-99001", "qty": 10 }]
}
```

**POST `/outbound/:id/confirm-relabel` Body 示例**

```json
{
  "items": [
    { "id": 1, "scannedBarcode": "OLD-BARCODE", "newBarcode": "NEW-FNSKU" }
  ]
}
```

---

## 11. 库存 `/inventory`（3）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/inventory` | 库存查询（SKU 维度） |
| GET | `/inventory/by-location` | 库位库存 |
| GET | `/inventory/logs/:sku` | SKU 变动日志 |

**GET Query：** `page`, `pageSize`, `keyword`, `warehouseCode`（`by-location` 另支持 `locationId`）

---

## 12. 仓库 `/warehouses`（4）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/warehouses` | 仓库列表 |
| GET | `/warehouses/:id` | 仓库详情 |
| POST | `/warehouses` | 创建仓库 |
| PATCH | `/warehouses/:id` | 更新仓库 |

**GET Query：** `type`（`logistics` / `overseas` / `wms`，可选）
`overseas` 为 API 别名，对应 DB 字段 `warehouse_type = wms`（海外仓）。

---

## 13. 库区 `/warehouse-zones`（3）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/warehouse-zones` | 库区列表（Query: `warehouseCode`） |
| POST | `/warehouse-zones` | 创建库区 |
| PUT | `/warehouse-zones/:id` | 更新库区 |

---

## 14. 库位 `/locations`（5）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/locations` | 库位列表（Query: `warehouseCode`, `zoneId`, `status`） |
| GET | `/locations/:id/inventory` | 库位库存明细 |
| POST | `/locations` | 创建库位 |
| POST | `/locations/batch` | 批量创建库位 |
| PUT | `/locations/:id` | 更新库位 |

---

## 15. 物流收货 `/logistics-receipts`（3）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/logistics-receipts/pending-pos` | 待收货 PO 列表 |
| GET | `/logistics-receipts` | 收货记录列表 |
| POST | `/logistics-receipts` | 创建收货单 |

**GET Query：** `page`, `pageSize`, `keyword`, `warehouseCode`

**POST Body 示例**

```json
{
  "poId": 1,
  "warehouseCode": "LW-SZ-01",
  "items": [{ "sku": "TK-99001", "receivedQty": 100 }]
}
```

---

## 16. 定价 `/pricing`（8）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/pricing` | 列表 |
| GET | `/pricing/:id` | 详情 |
| POST | `/pricing` | 创建 |
| PUT | `/pricing/:id` | 更新 |
| POST | `/pricing/:id/freight-callback` | 海运费回传 |
| POST | `/pricing/:id/confirm` | 确认定价 |
| POST | `/pricing/:id/sync-oms` | 同步 OMS |
| POST | `/pricing/:id/reprice` | 调价 |

**GET Query：** `page`, `pageSize`, `keyword`, `status`

**数据同步链路：**
1. 采购财务审核通过 → 写入 `costRmb`、`purchaseQty`、`domesticFee`（来自采购单），状态 `waiting_freight`
2. 入库发运海运费分摊 → `POST .../freight-callback` → 状态 `pending_pricing`
3. 确认定价 → `POST .../confirm` → 状态 `priced`
4. 同步 OMS → `POST .../sync-oms` → 状态 `synced`，`visibleOnOms=true`（OMS 客户可见货盘）
5. 海外仓入库上架完成且 `warehouseType=wms` 有可用库存 → `orderableOnOms=true`（OMS 客户可下单）

---

## 17. 成本 `/cost-ledger`（2）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/cost-ledger` | 列表 |
| POST | `/cost-ledger` | 新增 |

**GET Query：** `page`, `pageSize`, `keyword`, `costType`

---

## 18. 同步日志 `/sync-logs`（2）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/sync-logs` | 列表 |
| POST | `/sync-logs/:id/retry` | 重试 |

**GET Query：** `page`, `pageSize`, `keyword`, `status`, `syncType`

---

## 19. 客户 `/customers`（6）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/customers` | 列表 |
| GET | `/customers/:id` | 详情 |
| GET | `/customers/:id/recharges` | 充值记录 |
| POST | `/customers` | 创建 |
| PUT | `/customers/:id` | 更新 |
| POST | `/customers/:id/recharge` | 充值 |

**GET Query：** `page`, `pageSize`, `keyword`

---

## 20. 客户结算 `/billing`（9）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/billing/charges` | 费用明细列表 |
| POST | `/billing/charges` | 录入手工作业费 |
| POST | `/billing/generate/preview` | 生成账单预览 |
| POST | `/billing/generate` | 按时间范围汇总待入账费用生成账单 |
| GET | `/billing` | 账单列表（客户维度） |
| GET | `/billing/:id` | 账单详情 |
| POST | `/billing` | 手动创建账单（指定明细行） |
| POST | `/billing/:id/confirm` | 确认入账 |

**GET `/billing/charges` Query：** `page`, `pageSize`, `customerId`, `chargeType`, `source`（`wms`/`manual`）, `status`, `dateFrom`, `dateTo`, `keyword`

**POST `/billing/generate/preview` Body**

```json
{ "dateFrom": "2026-06-01", "dateTo": "2026-06-30", "customerId": 1 }
```

**Response.data：** `{ "chargeCount": 3, "totalAmount": 7500, "customerCount": 2 }`

**POST `/billing/generate` Body：** 同上

**Response.data：** `{ "bills": [...], "count": 2, "totalCharges": 3 }`

**POST `/billing/charges` Body**

```json
{
  "customerId": 1,
  "chargeType": "relabel",
  "amount": 2500,
  "description": "换标 × 500 件",
  "chargeDate": "2026-06-10",
  "source": "manual"
}
```

**费用类型 chargeType：** `wms_outbound` / `order_fee` / `picking` / `storage` / `outbound_ship` / `relabel` / `repack` / `handling` / `other`

---

## 21. 海运账单 `/freight-bills`（2）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/freight-bills` | 列表 |
| POST | `/freight-bills` | 创建 |

**GET Query：** `page`, `pageSize`, `keyword`, `status`

---

## 22. 利润 `/profit`（2）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/profit/summary` | 汇总 |
| GET | `/profit/detail` | 明细 |

**Query：** `month`（如 `2026-06`）

---

## 23. 公告 `/announcements`（5）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/announcements` | 列表 |
| GET | `/announcements/:id` | 详情 |
| POST | `/announcements` | 创建 |
| PUT | `/announcements/:id` | 更新 |
| DELETE | `/announcements/:id` | 删除 |

**GET Query：** `page`, `pageSize`, `keyword`, `status`

---

## 24. 异步 IO `/async-io`（7）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/async-io` | 任务列表 |
| POST | `/async-io/export` | 创建并执行导出任务 |
| POST | `/async-io/import` | 创建并执行导入任务 |
| POST | `/async-io` | 兼容旧接口（同 export/import） |
| GET | `/async-io/:id` | 任务详情 |
| GET | `/async-io/:id/download` | 下载导出文件 CSV |

**GET Query：** `page`, `pageSize`, `jobType`（`import`/`export`）

**POST `/async-io/export` Body**

```json
{ "module": "库存", "fileName": "inventory.csv", "params": {} }
```

**支持 module：** `库存`/`inventory`、`同步日志`/`sync`、`成本台账`/`cost`、`获客报表`/`leads_report`、`客户充值`/`customers`、`海运账单`/`freight`、`客户结算`/`billing`、`成交客户`/`leads_deals`

**POST `/async-io/import` Body**

```json
{ "module": "线索", "fileName": "leads.csv", "content": "客户名称,联系人\n..." }
```

---

## 25. 权限目录 `/permissions`（1）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/permissions/catalog` | 权限分组、角色模板、别名与废弃码（来源 `shared/permissions.catalog.ts`） |

---

## 接口总览

| # | 模块 | 前缀 | 数量 |
|---|------|------|------|
| 1 | 鉴权 | `/auth` | 2 |
| 2 | 用户 | `/users` | 6 |
| 3 | 工作台 | `/dashboard` | 4 |
| 4 | 线索 | `/leads` | 9 |
| 5 | 商品 | `/products` | 6 |
| 6 | 选品 | `/product-dev` | 8 |
| 7 | 供应商 | `/suppliers` | 5 |
| 8 | 采购 | `/purchase-orders` | 8 |
| 9 | 入库 | `/inbound` | 14 |
| 10 | 出库 | `/outbound` | 10 |
| 11 | 库存 | `/inventory` | 3 |
| 12 | 仓库 | `/warehouses` | 4 |
| 13 | 库区 | `/warehouse-zones` | 3 |
| 14 | 库位 | `/locations` | 5 |
| 15 | 物流收货 | `/logistics-receipts` | 3 |
| 16 | 定价 | `/pricing` | 8 |
| 17 | 成本 | `/cost-ledger` | 2 |
| 18 | 同步 | `/sync-logs` | 2 |
| 19 | 客户 | `/customers` | 6 |
| 20 | 客户结算 | `/billing` | 9 |
| 21 | 海运账单 | `/freight-bills` | 2 |
| 22 | 利润 | `/profit` | 2 |
| 23 | 公告 | `/announcements` | 5 |
| 24 | 异步 IO | `/async-io` | 7 |
| 25 | 权限目录 | `/permissions` | 1 |
| | **合计** | | **132** |

---

## 对照：两系统架构变更（WMS 推送已移除）

| 变更 | 说明 |
|------|------|
| 已移除 | `POST /inbound/retry-failed`、`POST /inbound/:id/push-wms`、`autoPushWms` 创建参数 |
| 新增入库 | `start-receive`、`qc`、`resolve-exception`、`putaway` |
| 新增模块 | `/outbound/*`、`/warehouse-zones/*`、`/locations/*` |
| 权限目录 | `GET /permissions/catalog` — migration 模式走 **erp-auth-service**（classpath JSON）；直连 NestJS 时仍可用 |
| 库存 | 新增 `GET /inventory/by-location` |
| 仓库查询 | `type=overseas` 为海外仓别名（DB 仍 `wms`） |

---

## 对照：旧文档遗漏（历史）

以下接口在上一版文档（83 条）中**未记录**，现已补全：

| 模块 | 遗漏接口 |
|------|----------|
| 线索 | `POST /leads/import` |
| 商品 | `GET /products/by-sku/:sku/label` |
| 采购 | `POST /purchase-orders/:id/reject-po-audit`、`POST /purchase-orders/:id/reject-finance` |
| 入库 | `GET/POST/DELETE /inbound/drafts*`、`POST /inbound/attachments`、收货/清点/上架链路、`GET /inbound/:id/labels/*` |
| 仓库 | `GET /warehouses/:id`、`PATCH /warehouses/:id` |
| 物流收货 | **整模块** `GET/POST /logistics-receipts*`、`GET /logistics-receipts/pending-pos` |
| 客户结算 | `GET/POST /billing/charges`、`POST /billing/generate/preview`、`POST /billing/generate` |
| 异步 IO | `POST /async-io/export`、`POST /async-io/import`、`GET /async-io/:id`、`GET /async-io/:id/download` |

---

## 对照：后端 vs 前端 `client.js`

| 状态 | 数量 | 说明 |
|------|------|------|
| 已封装 | **132+** | 工作台含 `stats/trends/announcements/notifications`；其余模块以 `client.js` 为准 |
| 未封装 | **0** | — |

### 前端封装映射

| client.js | 后端路径 |
|-----------|----------|
| `authApi` | `/auth/*` |
| `dashboardApi` | `/dashboard/*` |
| `usersApi` | `/users/*` |
| `permissionsApi` | `/permissions/catalog` |
| `leadApi` | `/leads/*` |
| `productApi` | `/products/*`（含 `downloadSkuLabel`） |
| `productDevApi` | `/product-dev/*` |
| `supplierApi` | `/suppliers/*` |
| `purchaseApi` | `/purchase-orders/*` |
| `inboundApi` | `/inbound/*`（草稿/附件/标签/收货/清点/上架） |
| `outboundApi` | `/outbound/*`（含 CPT 附件） |
| `inventoryApi` | `/inventory/*`（含 `byLocation`） |
| `warehouseApi` | `/warehouses/*` |
| `warehouseZoneApi` | `/warehouse-zones/*` |
| `locationApi` | `/locations/*` |
| `logisticsReceiptApi` | `/logistics-receipts/*` |
| `pricingApi` | `/pricing/*` |
| `costApi` | `/cost-ledger/*` |
| `syncApi` | `/sync-logs/*` |
| `customerApi` | `/customers/*` |
| `billingApi` | `/billing/*` |
| `freightBillApi` | `/freight-bills/*` |
| `profitApi` | `/profit/*` |
| `announcementApi` | `/announcements/*` |
| `asyncIoApi` | `/async-io/*`（含 `download` 文件流） |

### 仅后端存在、前端暂未调用的封装（可后续接入）

| 方法 | 路径 | client 方法 |
|------|------|-------------|
| GET | `/async-io/:id` | `asyncIoApi.detail` |
| POST | `/billing` | `billingApi.create`（手动建账，生成账单走 `generate`） |
| GET | `/warehouses/:id` | `warehouseApi.detail` |

---

## 测试账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | 123456 | 系统管理员 |
| zhaomin | 123456 | 采购主管 |
| liuyang | 123456 | 产品开发主管 |
| linxinyi | 123456 | 销售 |
| sunhao | 123456 | 采购 |
| chenqi | 123456 | 陪跑 |

---

## 维护说明

重新扫描 Controller 并核对数量：

```bash
cd backend
node -e "
const fs=require('fs'),path=require('path');
function walk(d){return fs.readdirSync(d,{withFileTypes:1}).flatMap(x=>{const p=path.join(d,x.name);return x.isDirectory()?walk(p):p.endsWith('.controller.ts')?[p]:[]})}
let n=0; walk('src/modules').forEach(f=>{
  const t=fs.readFileSync(f,'utf8');
  n += [...t.matchAll(/@(Get|Post|Put|Patch|Delete)\(/g)].length;
}); console.log('接口总数:', n);
"
```

期望输出：`接口总数: 108`
