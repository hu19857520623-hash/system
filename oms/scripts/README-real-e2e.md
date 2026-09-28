# 真实数据端到端测试前置检查

在执行任何会建单或改变库存的步骤前，从 `oms/` 目录运行 `npm run e2e:real:preflight`。该命令仅核对 API 健康、文件、账号登录与流程权限，以及已连接的 Android/PDA；它**不是**三条流程的完成证明，也不会创建订单。账号验证会真实登录并核对 ERP 流程权限、OMS 客户类型与权限，但不会输出密码或访问令牌。

通过环境变量提供以下信息，不要把密码写入仓库：

| 类别 | 环境变量 |
| --- | --- |
| 服务 | `ERP_E2E_BASE`（通常含 `/api`）、`OMS_E2E_BASE`（根地址或含 `/api` 均可） |
| ERP 账号 | `ERP_E2E_USERNAME`、`ERP_E2E_PASSWORD` |
| 货盘客户账号 | `OMS_E2E_CATALOG_USERNAME`、`OMS_E2E_CATALOG_PASSWORD` |
| 电商客户账号 | `OMS_E2E_ECOMMERCE_USERNAME`、`OMS_E2E_ECOMMERCE_PASSWORD` |
| 商品数据 | `E2E_XLSX_FILE`、`E2E_ERP_IMAGE_FILE`、`E2E_ECOMMERCE_IMAGE_FILE` |
| 货盘发货文件 | `E2E_CATALOG_OUTER_LABEL_PDF`、`E2E_CATALOG_BOOKING_PDF`、`E2E_CATALOG_SHIPPING_NOTE_PDF`、`E2E_CATALOG_PRODUCT_LABEL_PDF` |
| 电商发货文件 | `E2E_ECOMMERCE_OUTER_LABEL_PDF`、`E2E_ECOMMERCE_BOOKING_PDF`、`E2E_ECOMMERCE_SHIPPING_NOTE_PDF`、`E2E_ECOMMERCE_PRODUCT_LABEL_PDF` |
| 设备 | `PDA_E2E_ADB`（可省略，如果 `adb` 已在 PATH）、`PDA_E2E_SERIAL`（多台设备时必填） |

两种客户流程必须使用不同业务预约号的真实预约单；仅文件路径或文件名不同不算两份预约。前置检查会读取预约单内容，核对预约号、PO、卖家和仓库。完整执行还需分别验证：ERP 选品/采购/发运和 PDA 入库、上架、出库；货盘客户 OMS 采购/上传与 ERP PDA 出库及 POD；电商客户 XLSX 与逐条上传、OMS 发货、ERP PDA 入库上架、OMS 出库和 ERP POD。每条流程都要留存实际单号、图片、财务字段和最终状态证据。

`E2E_XLSX_FILE` 必须是 OMS 商品导入模板对应的真实业务数据。仅能被 Excel 打开不代表可以导入；前置检查会按必填列、SKU 长度和逐行数值规则校验。`oms商品数据.xlsx` 等外部系统导出表若列名不同，先按已核实的源字段建立映射，不要把占位值当真实申报信息。

## 最终验收证据

三条实单流程全部执行完后，复制 `scripts/e2e-real-evidence.example.json`，只填写真实业务 ID、单号和原始文件路径，然后运行：

```powershell
npm run e2e:real:evidence -- D:\path\to\real-evidence.json
```

验收器是只读的，不建单、不改库存。它会重新登录 ERP、货盘 OMS 和电商 OMS，逐项核对：选品审核、采购及财务字段、PDA 入库上架、PDA 实测复核与发运、货盘采购、XLSX 与逐条商品来源、图片、两组四份真实发货文件、两张 POD 在 ERP 的原文件回读，以及每个 PDA 阶段的截图/XML。任意占位/演示单号（如 `REAL-*`、`E2E*`）或缺失证据都会失败，并输出 JSON 报告。只有该报告全部通过，才可作为最终交付证明。

`verify-takealot-label-e2e.ts` 是早期标签联调脚本，会生成 `E2ELBL*` 数据，不得用于本次真实全流程验收。
