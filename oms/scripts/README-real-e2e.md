# 真实数据端到端测试前置检查

在执行任何会建单或改变库存的步骤前，从 `oms/` 目录运行 `npm run e2e:real:preflight`。该命令仅核对 API 健康、文件、账号配置和已连接的 Android/PDA；它**不是**三条流程的完成证明，也不会创建订单。

通过环境变量提供以下信息，不要把密码写入仓库：

| 类别 | 环境变量 |
| --- | --- |
| 服务 | `ERP_E2E_BASE`（含 `/api`）、`OMS_E2E_BASE` |
| ERP 账号 | `ERP_E2E_USERNAME`、`ERP_E2E_PASSWORD` |
| 货盘客户账号 | `OMS_E2E_CATALOG_USERNAME`、`OMS_E2E_CATALOG_PASSWORD` |
| 电商客户账号 | `OMS_E2E_ECOMMERCE_USERNAME`、`OMS_E2E_ECOMMERCE_PASSWORD` |
| 商品数据 | `E2E_XLSX_FILE`、`E2E_ERP_IMAGE_FILE`、`E2E_ECOMMERCE_IMAGE_FILE` |
| 货盘发货文件 | `E2E_CATALOG_OUTER_LABEL_PDF`、`E2E_CATALOG_BOOKING_PDF`、`E2E_CATALOG_SHIPPING_NOTE_PDF`、`E2E_CATALOG_PRODUCT_LABEL_PDF` |
| 电商发货文件 | `E2E_ECOMMERCE_OUTER_LABEL_PDF`、`E2E_ECOMMERCE_BOOKING_PDF`、`E2E_ECOMMERCE_SHIPPING_NOTE_PDF`、`E2E_ECOMMERCE_PRODUCT_LABEL_PDF` |
| 设备 | `PDA_E2E_ADB`（可省略，如果 `adb` 已在 PATH）、`PDA_E2E_SERIAL`（多台设备时必填） |

两种客户流程必须使用不同的真实预约单。完整执行还需分别验证：ERP 选品/采购/发运和 PDA 入库、上架、出库；货盘客户 OMS 采购/上传与 ERP PDA 出库及 POD；电商客户 XLSX 与逐条上传、OMS 发货、ERP PDA 入库上架、OMS 出库和 ERP POD。每条流程都要留存实际单号、图片、财务字段和最终状态证据。

`E2E_XLSX_FILE` 必须是 OMS 商品导入模板对应的真实业务数据。仅能被 Excel 打开不代表可以导入；前置检查会按必填列、SKU 长度和逐行数值规则校验。`oms商品数据.xlsx` 等外部系统导出表若列名不同，先按已核实的源字段建立映射，不要把占位值当真实申报信息。
