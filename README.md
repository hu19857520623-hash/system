# system

ERP + OMS 一体化工程仓库，包含：

- `erp/` — ERP 后端（NestJS）与前端（Vue）
- `oms/` — OMS 后端与前端（React）
- `pda/` — 仓库 PDA 安卓作业端（入库/出库扫码）
- `scripts/` — 全链路验证与审计脚本

浏览器预览 PDA 界面：打开 `pda/preview/index.html`。

## Docker 本地全栈

```powershell
cp docker.env.example .env
docker compose up --build
```

| 服务 | 地址 |
|------|------|
| ERP 前端 | http://127.0.0.1:5180 |
| ERP API | http://127.0.0.1:3000 |
| OMS 前端 | http://127.0.0.1:5173 |
| OMS API | http://127.0.0.1:3001 |
| MySQL | `127.0.0.1:3307` |

可选：

```powershell
docker compose --profile monitor up --build   # Takealot 监控代理
docker compose --profile seed run --rm erp-seed
```

镜像设计要点：多阶段构建、BuildKit npm 缓存、Alpine、非 root、`nginx-unprivileged`、`no-new-privileges`。
