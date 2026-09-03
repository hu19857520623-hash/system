# 仓库 PDA（Android）

轻量安卓作业端，对接 ERP 入库 / 出库扫码接口。面向手持 PDA，不做建单、对账、打印。

## 先看界面（不用装 Android Studio）

用浏览器打开：

```
pda/preview/index.html
```

在 Cursor 里：资源管理器找到该文件 → 右键 Open Preview / 用浏览器打开。  
这是和 App 同布局的交互预览：登录、首页、到仓、收货、清点、上架、拣货、复核、盘点。

## 看真正的安卓 App

1. 安装 [Android Studio](https://developer.android.com/studio)（Ladybug / 2024.2+，JDK 17）。
2. **Open** → 选本仓库的 `pda/` 目录。
3. 等待 Gradle Sync。
4. 顶部设备选 **Medium Phone** 模拟器，点绿色 Run。

真机：用 USB 打开「开发者选项 → USB 调试」，选这台 PDA 再 Run。

服务器地址不在普通仓管登录页显示。生产安装包必须在构建时预置线上 ERP API 地址：

```powershell
.\gradlew.bat assembleRelease -PPDA_API_BASE_URL=https://erp.example.com/api
```

地址写入安装包后，首次安装即可登录；登录后只有具备 `inbound.handle_exception`（异常放行）主管权限的账号能在「设置 → 主管设置」中查看和修改服务器。

开发环境默认服务器：

- 模拟器：`http://10.0.2.2:3000/api`
- 真机调试构建参数可使用电脑局域网地址，例如 `-PPDA_API_BASE_URL=http://192.168.1.20:3000/api`
  同时把 ERP `.env` 的 `LISTEN_HOST` 改成 `0.0.0.0` 后重启后端。

账号与 Web ERP 相同，使用「仓库」角色。

## Gradle 一直卡在 Importing？

国内首次同步要下载 Gradle + Android 依赖，网络不好会一直转圈。按顺序试：

1. **先点进度条右侧 X 取消**，看底部 **Build** 窗口红色报错（把最后几行发出来）。
2. **确认 Android Studio 版本**：建议 2024.2+（Ladybug），**JDK 17**  
   `File → Settings → Build → Gradle → Gradle JDK` 选 **17**。
3. **装 Android SDK**：`Tools → SDK Manager`，勾选 **Android 14 (API 34)** 和 **Android SDK Build-Tools**，Apply。
4. **命令行测下载**（在 `pda` 目录 PowerShell）：
   ```powershell
   .\gradlew.bat --version
   ```
   能输出版本号说明 Gradle 已下好；若卡住，多半是网络问题。
5. **清缓存重开**：关掉 Android Studio，删除项目里的 `.gradle` 文件夹，再 Open 工程。
6. 本工程已配置 **阿里云 Maven + 腾讯云 Gradle 镜像**；若仍失败，检查是否开了代理/VPN 冲突。

## 作业范围

| 模块 | PDA 做什么 | 对接接口 |
|---|---|---|
| 入库-到仓 | 只扫入库单号 | `POST /api/inbound/arrival-scan` |
| 入库-收货 | 扫外箱标或 SKU | `POST /api/inbound/:id/receive-box` |
| 入库-清点 | 扫 SKU 累加实收，提交清点 | `POST /api/inbound/:id/scan-qc`、`/qc` |
| 入库-上架 | 扫 SKU → 扫库位 | `POST /api/inbound/:id/putaway` |
| 出库-拣货 | 仅扫已分配给本工位/账号的出库单；默认按箱扫（一次记满库位件数），可切逐件 | `GET /api/outbound/:id/pick-suggestions`、`POST /api/outbound/:id/pick` |
| 出库-复核 | 扫 SKU 复核后提交 | `POST /api/outbound/:id/start-review`、`/pack` |
| 在库-盘点 | 扫盘点单，按库位/SKU 提交实盘 | `GET /api/management-loop/stocktakes`、`POST /api/management-loop/stocktakes/:id/count` |
