# 仓库 PDA（Android）

轻量安卓作业端，对接 ERP 入库 / 出库扫码接口。面向手持 PDA，不做建单、对账、打印。

## 先看界面（不用装 Android Studio）

用浏览器打开：

```
pda/preview/index.html
```

在 Cursor 里：资源管理器找到该文件 → 右键 Open Preview / 用浏览器打开。  
这是和 App 同布局的交互预览：登录、首页、到仓、收货、清点、上架、拣货、复核。

## 看真正的安卓 App

1. 安装 [Android Studio](https://developer.android.com/studio)（Ladybug / 2024.2+，JDK 17）。
2. **Open** → 选本仓库的 `pda/` 目录。
3. 等待 Gradle Sync。
4. 顶部设备选 **Medium Phone** 模拟器，点绿色 Run。

真机：用 USB 打开「开发者选项 → USB 调试」，选这台 PDA 再 Run。

登录页服务器：

- 模拟器：`http://10.0.2.2:3000/api`
- 真机：电脑局域网地址，例如 `http://192.168.1.20:3000/api`  
  同时把 ERP `.env` 的 `LISTEN_HOST` 改成 `0.0.0.0` 后重启后端。

账号与 Web ERP 相同，使用「仓库」角色。

## 作业范围

| 模块 | PDA 做什么 | 对接接口 |
|---|---|---|
| 入库-到仓 | 扫入库单号 / 跟踪号 / 仓单号 | `POST /api/inbound/arrival-scan` |
| 入库-收货 | 扫外箱标或 SKU | `POST /api/inbound/:id/receive-box` |
| 入库-清点 | 扫 SKU 累加实收，提交清点 | `POST /api/inbound/:id/scan-qc`、`/qc` |
| 入库-上架 | 扫 SKU → 扫库位 | `POST /api/inbound/:id/putaway` |
| 出库-拣货 | 扫出库单，按建议库位拣货 | `GET /api/outbound/:id/pick-suggestions`、`POST /api/outbound/:id/pick` |
| 出库-复核 | 扫 SKU 复核后提交 | `POST /api/outbound/:id/start-review`、`/pack` |
