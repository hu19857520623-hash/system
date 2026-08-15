# Takealot ERP · 后端服务

基于 **NestJS + TypeScript + Prisma + MySQL** 的 ERP 后端，对接前端 `/api` 接口，连接本地数据库 `takealot_erp`。

## 技术栈

| 类别 | 选型 |
|---|---|
| 框架 | NestJS 10 |
| 语言 | TypeScript 5 |
| ORM | Prisma 5 |
| 数据库 | MySQL 8.0 |
| 鉴权 | JWT（@nestjs/jwt + passport-jwt） |
| 密码 | bcryptjs |
| 校验 | class-validator / class-transformer |

## 目录结构

```
backend/
├─ prisma/
│  ├─ schema.prisma      # 映射 takealot_erp 28 张表
│  └─ seed.ts            # 设置种子用户登录密码
├─ src/
│  ├─ main.ts            # 启动入口（全局前缀 /api、CORS、统一响应）
│  ├─ app.module.ts      # 根模块（全局 JWT + 角色守卫）
│  ├─ common/            # 公共：Prisma、拦截器、过滤器、守卫、装饰器、DTO
│  └─ modules/           # 业务模块（每个模块含 controller/service/module）
│     ├─ auth/           # 登录鉴权
│     ├─ users/          # 用户管理
│     ├─ products/       # 商品主数据
│     ├─ suppliers/      # 供应商
│     ├─ product-dev/    # 选品开发（提交/审核/驳回）
│     ├─ purchase/       # 采购订单（采购审核/财务审核）
│     ├─ inbound/        # 入库（确认入库回写库存）
│     ├─ inventory/      # 库存查询
│     ├─ leads/          # 线索/跟进/成交/获客报表
│     ├─ customers/      # 客户/充值
│     ├─ billing/        # 客户结算
│     ├─ cost/           # 成本台账
│     ├─ profit/         # 利润分析
│     ├─ sync-log/       # 同步日志（重试）
│     ├─ async-io/       # 异步导入导出
│     ├─ announcement/   # 系统公告
│     ├─ warehouse/      # 仓库
│     ├─ freight-bill/   # 供应商海运账单
│     ├─ pricing/        # 货盘定价
│     └─ dashboard/      # 工作台统计
├─ docs/
│  └─ API.md             # 完整 API 接口文档（83 个）
├─ Dockerfile
└─ .env                  # 数据库连接、JWT 密钥、端口
```

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 生成 Prisma Client（数据库表已存在，无需迁移）
npm run prisma:generate

# 3. 初始化种子用户密码（默认 123456）
npm run seed

# 4. 启动开发服务
npm run start:dev
```

服务启动后：`http://localhost:3000/api`

## 环境变量（.env）

```
DATABASE_URL="mysql://root:密码@localhost:3306/takealot_erp"
JWT_SECRET="..."
JWT_EXPIRES_IN="7d"
PORT=3000
```

## 登录账号（seed 后）

| 用户名 | 角色 | 密码 |
|---|---|---|
| admin | 系统管理员 | 123456 |
| ops | 运营主管 | 123456 |
| buyer | 采购员 | 123456 |
| wh | 仓库管理员 | 123456 |
| finance | 财务 | 123456 |
| cs | 客服 | 123456 |

## 统一响应结构

```json
{ "code": 0, "message": "ok", "data": { } }
```

出错时 `code` 为 HTTP 状态码，`message` 为错误描述。

## 主要接口

| 模块 | 方法 | 路径 |
|---|---|---|
| 登录 | POST | `/api/auth/login` |
| 当前用户 | GET | `/api/auth/profile` |
| 商品 | GET/POST/PUT/DELETE | `/api/products` |
| 供应商 | GET/POST/PUT/DELETE | `/api/suppliers` |
| 选品 | GET/POST + `/:id/submit\|approve\|reject` | `/api/product-dev` |
| 采购单 | GET/POST + `/:id/approve\|finance-approve` | `/api/purchase-orders` |
| 入库 | GET/POST + `/:id/confirm` | `/api/inbound` |
| 库存 | GET | `/api/inventory` |
| 线索 | GET/POST/PUT + `/:id/follow-up\|deal` | `/api/leads` |
| 获客报表 | GET | `/api/leads/report` |
| 客户 | GET/POST/PUT + `/:id/recharge` | `/api/customers` |
| 结算 | GET/POST + `/:id/confirm` | `/api/billing` |
| 成本台账 | GET/POST | `/api/cost-ledger` |
| 利润 | GET | `/api/profit/summary` `/api/profit/detail` |
| 同步日志 | GET + `/:id/retry` | `/api/sync-logs` |
| 异步IO | GET/POST | `/api/async-io` |
| 公告 | GET/POST/PUT/DELETE | `/api/announcements` |
| 工作台 | GET | `/api/dashboard/stats` |

## Docker

```bash
docker build -t erp-backend .
docker run -p 3000:3000 --env-file .env erp-backend
```
