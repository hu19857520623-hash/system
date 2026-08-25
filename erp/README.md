# Takealot ERP

面向海外仓业务的 ERP 工程。仓库采用渐进式迁移：Vue 前端通过统一 `/api`
契约访问系统，NestJS 仍承载主要业务，Spring Cloud 服务按领域逐步接管接口。

## 工程组成

| 目录 | 职责 |
|---|---|
| `frontend/` | Vue 3、Vite、Element Plus Web 应用 |
| `backend/` | NestJS、Prisma、MySQL 主业务服务 |
| `services/` | Spring Cloud 网关、认证服务及迁移中的领域服务 |
| `shared/` | 跨 Node/Java 同步的权限目录源文件 |
| `scripts/` | 本地启动、验收和运维脚本 |
| `docs/` | 架构、流程、安全和操作文档 |

Takealot 店铺监控已拆分为仓库根目录的独立工程 `../store-monitor/`，ERP 通过
`TAKEALOT_PROXY_URL` 与它通信。

详细边界见 [工程架构](docs/architecture/overview.md) 和
[Spring 迁移清单](docs/migration/spring-strangler.md)。

## 环境要求

- Node.js 24.17（见 `.node-version` / `.nvmrc`）
- JDK 21
- Docker Desktop，或本地 MySQL 8

不要提交 `.env`、数据库转储、客户名单、浏览器 Profile 或导入中间文件。

## 本地启动

1. 复制 `.env.example` 为 `.env`，替换数据库密码和 JWT 密钥。
2. 首次创建本地数据库时，可临时设置 `AUTO_SCHEMA_SYNC=true`；完成后立即恢复
   为 `false`。
3. 启动：

```powershell
docker compose up --build
```

启用 Spring 迁移路由：

```powershell
docker compose -f docker-compose.yml -f docker-compose.spring.yml up --build
```

## 数据库变更

- 业务请求和 seed 不允许执行 DDL。
- 新迁移放入 `backend/prisma/scripts/`，并登记在
  `backend/prisma/migration-plan.ts`。
- 现有数据库第一次接入迁移台账前必须备份，然后显式运行
  `npm run migrate:baseline`。
- 常规部署运行 `npm run migrate:all`；checksum 不一致或任一迁移失败都会停止。

## 质量检查

分别安装 `backend`、`frontend` 的依赖后，在根目录执行：

```powershell
npm run verify
```

Spring 服务：

```powershell
cd services
.\mvnw.cmd test
```

Pull Request 会自动运行 Node 和 Spring 两组检查。

## 敏感数据

Excel/SQL 导入中间产物默认写入 `data/imports/`，该目录已被 Git 忽略。若历史提交
中曾包含真实客户数据，仅删除当前文件并不能清除历史，需要另外执行受控的历史清理。
