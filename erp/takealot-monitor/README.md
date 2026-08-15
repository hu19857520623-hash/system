# Takealot 卖家数据中心

高保真 Web 管理界面，用于查看 Takealot Marketplace API 数据（报价、销售、交易、发货、退货、卖家信息等）。

## 对方需要安装什么？

只需要安装 **Node.js**（自带 npm），其它不用装。

| 环境 | 要求 |
| --- | --- |
| **Node.js** | 18 或更高版本（推荐 LTS） |
| **npm** | 随 Node.js 自动安装 |
| **浏览器** | Chrome / Edge / Firefox 等现代浏览器 |
| **网络** | 能访问 `marketplace-api.takealot.com` |
| **Takealot API Key** | 在卖家后台生成（API Integrations → Authentication） |

不需要安装：Python、Java、MySQL、Apifox、数据库等。

### 下载 Node.js

官网：https://nodejs.org/  
选 **LTS（长期支持版）** 下载安装，一路下一步即可。

安装后打开命令行验证：

```bash
node -v
npm -v
```

能显示版本号即安装成功。

---

## 快速启动（Windows）

1. 解压收到的 zip 包到任意文件夹（路径不要有中文空格问题可忽略，但建议纯英文路径更稳）
2. 双击 **`启动.bat`**
3. 首次运行会自动 `npm install` 安装依赖（约 10～30 秒）
4. 浏览器打开：**http://localhost:3456**
5. 进入 **系统设置**，填入 API Key 并保存

关闭：在黑色命令行窗口按 `Ctrl + C`，或直接关窗口。

---

## 快速启动（macOS / 苹果电脑）

1. 解压 zip 到任意文件夹（建议路径不要太深）
2. 安装 **Node.js LTS**：https://nodejs.org/  
   或用 Homebrew：`brew install node`
3. 打开 **终端（Terminal）**，进入解压目录，例如：

```bash
cd ~/Downloads/TakealotProject
chmod +x 启动.sh
./启动.sh
```

首次运行会自动 `npm install`，然后打开浏览器访问 **http://localhost:3456**。

**注意：**
- 需已安装 **Google Chrome**（API 转发依赖 Chrome）
- 若提示「无法打开」或权限问题，先执行 `chmod +x 启动.sh`
- 停止服务：终端里按 `Ctrl + C`

**不用脚本、手动启动也可以：**

```bash
cd 解压后的文件夹
npm install
npm start
```

浏览器访问：http://localhost:3456

---

```bash
cd 解压后的文件夹
npm install
npm start
```

浏览器访问：http://localhost:3456

---

## 使用说明

1. 首次使用 → **系统设置 → 纳管卖家** → 添加各店铺 API Key → **保存全部卖家**
2. 顶部 **当前卖家** 下拉框切换单店数据（概览/报价/订单等）
3. **月销售排名** / **昨日销售排名** 仍为全部卖家汇总

| 菜单 | 对应 API |
| --- | --- |
| 数据概览 | 余额 + 报价 + 销售汇总 |
| **月销售排名** | 多卖家 GET /sales 聚合（当月 SAST） |
| **昨日销售排名** | 多卖家 GET /sales 聚合 + 订单明细 |
| 商品报价 | GET /offers |
| 销售订单 | GET /sales |
| 交易流水 | GET /transactions |
| 发货管理 | GET /shipments（只读）|
| 退货管理 | GET /returns |
| 卖家信息 | GET /seller |

---

## 常见问题

### 1. 双击启动.bat 闪退？

- 未安装 Node.js → 先安装 Node.js
- 或右键「以管理员身份运行」再试

### 2. 页面打不开？

- 确认命令行里显示：`Takealot 卖家数据中心: http://localhost:3456`
- 端口 3456 被占用时，可改环境变量后启动：

```bash
set PORT=8080
npm start
```

然后访问 http://localhost:8080

### 3. API 401 / 鉴权失败？

- 检查 API Key 是否正确
- 在卖家后台确认 Key 仍有效（重新生成会使旧 Key 失效）

### 4. 两种模式都不行？是环境问题吗？

**分三种情况：**

| 报错 | 原因 | 是否环境问题 |
| --- | --- | --- |
| `浏览器直连失败 (CORS)` | Takealot API **不允许** localhost 跨域访问 | **不是**，直连模式本身不可用，请忽略 |
| `Node/curl 被 Cloudflare 拦截` | 脚本请求指纹被拦 | **部分是**（IP/网络风控） |
| 浏览器能开 `/status` 但应用失败 | 旧版 zip 或 Chrome 通道未启用 | **换 v1.0.2** |

**正确做法（v1.0.2）：**

1. 使用 **`Takealot卖家数据中心-v1.0.2.zip`**
2. 双击 `启动.bat`（首次会 `npm install`，需联网约 30 秒）
3. 确认左下角版本 **v1.0.2**，命令行显示 `优先 Chrome → curl → node`
4. 系统设置 → **网络自检** → 看哪条通道 ✓
5. 若 Chrome ✗ 但浏览器能开 `/status` → 点 **「浏览器验证」** 弹出 Chrome 完成验证
6. 保存 API Key 并检测连接

**必须安装 Google Chrome 或 Edge**（v1.0.2 用真实浏览器引擎转发，不用「浏览器直连」）。

### 6. 在别人电脑上出现红色 Cloudflare 拦截页？

这是 **Takealot 的防火墙按 IP/网络环境拦截**，不是程序装错了。

**先让对方在浏览器直接打开：**

https://marketplace-api.takealot.com/v1/status

| 浏览器结果 | 说明 |
| --- | --- |
| 显示 `{"status":"ok"}` | 换 **v1.0.2** zip → 网络自检 → 必要时「浏览器验证」 |
| 也显示 Cloudflare 拦截页 | **对方网络/IP 被拦**，与程序无关 |

**常见原因：**

- 公司/机房网络、云服务器 IP
- 某些地区宽带 IP 被风控
- 使用可疑 VPN/代理

**解决办法：**

1. 换 **家庭宽带** 网络试
2. 换 **手机热点** 试
3. 使用 **南非或欧美节点** 的 VPN（Takealot 是南非平台）
4. 联系 Takealot 卖家支持，说明 API 访问被 Cloudflare 拦截

> 你电脑能跑、别人电脑不能跑：若对方浏览器 `/status` 正常，请让对方换 **v1.0.2** 并运行网络自检。

---

## 更新日志

### v1.1.1
- 数据概览、报价、订单等模块顶部支持切换纳管卖家

### v1.1.0
- 多卖家 API Key 纳管、月销售排名、昨日销售排名与订单明细

### v1.0.2
- 优先用本机 **Chrome/Edge 真实浏览器**（puppeteer-core）转发 API，与地址栏访问同引擎
- 新增「网络自检」「浏览器验证」（弹出 Chrome 过 Cloudflare）
- 移除无效的「浏览器直连」模式

### v1.0.1
- curl 代理、版本号显示

### v1.0.0
- 初始版本

---

## 项目结构

```
TakealotProject/
├── 启动.bat              # Windows 一键启动
├── package.json          # 依赖配置
├── server/index.js       # 本地服务 + API 代理
├── web/                  # 前端界面
│   ├── index.html
│   ├── css/dashboard.css
│   └── js/
├── data/snapshots/       # 预留数据目录（可扩展入库）
└── takealot-marketplace-api.openapi.json  # API 参考文档
```

---

## 技术说明

- 前端：纯静态 HTML/CSS/JS
- 后端：Express + Chrome/Edge 浏览器转发（puppeteer-core）+ curl/node 备用
- 默认端口：`3456`

---

## 许可证

内部使用工具，API 数据归属 Takealot 平台及对应卖家账户。
