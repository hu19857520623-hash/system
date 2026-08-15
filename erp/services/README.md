# TKL ERP — Spring Cloud 微服务骨架

基于 **Spring Boot 3.4.5** + **Spring Cloud 2024.0.1** + **JDK 21**，与现有 NestJS 后端并行，采用 strangler-fig 逐步迁移。

## 模块结构

```
services/
├── pom.xml                    # 父 POM
├── erp-common/                # 公共 DTO（ApiResponse 等）
├── erp-registry/              # Eureka 注册中心 :8761
├── erp-gateway/               # API 网关 :9000
├── erp-auth-service/          # 认证/用户 :9101
├── erp-crm-service/           # 获客/客户/账单 :9102
├── erp-scm-service/           # 供应链 :9103
├── erp-finance-service/       # 财务 :9104
└── erp-integration-service/   # 集成/监控 :9105
```

## 技术栈

| 组件 | 版本 |
|------|------|
| JDK | 21 |
| Spring Boot | 3.4.5 |
| Spring Cloud | 2024.0.1 (Moorgate) |
| 注册中心 | Netflix Eureka |
| 网关 | Spring Cloud Gateway |
| 数据库 | 暂用现有 MySQL `takealot_erp`（各服务后续接入） |

## 本地开发

### 前置条件

- JDK 21（`JAVA_HOME` 已配置）
- Maven 3.9+（或使用项目内 `mvnw`）

### 编译

```bash
cd services
mvn clean package -DskipTests
```

### 启动顺序（本地）

开多个终端，依次运行：

```bash
# 1. 注册中心
mvn -pl erp-registry spring-boot:run

# 2. 网关（默认把所有 /api/** 转发到 NestJS :3000）
mvn -pl erp-gateway spring-boot:run

# 3. 各业务服务（可选）
mvn -pl erp-auth-service spring-boot:run
mvn -pl erp-crm-service spring-boot:run
# ...
```

Windows 一键脚本：

```powershell
.\scripts\start-spring-local.ps1
```

### 验证

| 地址 | 说明 |
|------|------|
| http://localhost:8761 | Eureka 控制台 |
| http://localhost:9000/api/auth/login | 经网关转发到 NestJS |
| http://localhost:9101/auth/ping | auth 服务骨架 |
| http://localhost:9101/internal/meta | 服务元信息 |

## Docker 启动

在已有 `docker compose up` 栈基础上叠加 Spring Cloud：

```bash
docker compose -f docker-compose.yml -f docker-compose.spring.yml up -d --build
```

| 宿主机端口 | 服务 |
|-----------|------|
| 8761 | erp-registry |
| 9000 | erp-gateway |
| 9101–9105 | 各微服务 |

## 迁移策略

1. **默认模式**：网关将全部 `/api/**` 代理到 NestJS（`LEGACY_BACKEND_URL`），不影响现有前端。
2. **迁移模式**：网关启用 `migration` profile 后，已迁移路径走 Java 服务，其余仍走 NestJS：

   ```bash
   SPRING_PROFILES_ACTIVE=migration mvn -pl erp-gateway spring-boot:run
   ```

3. **推荐迁移顺序**：`auth` → `integration` → `crm` → `scm` → `finance`

### SCM 代理路径（migration profile → erp-scm-service → NestJS）

| 前缀 | 说明 |
|------|------|
| `/api/products/**` | 商品 |
| `/api/inbound/**` | 入库（ERP 内部闭环） |
| `/api/outbound/**` | 出库 |
| `/api/inventory/**` | 库存 |
| `/api/warehouses/**` | 仓库 |
| `/api/warehouse-zones/**` | 库区 |
| `/api/locations/**` | 库位 |
| `/api/logistics-receipts/**` | 物流收货 |

| `/api/auth/**` | 登录 / 个人资料 |
| `/api/users/**` | 用户与权限分配 |
| `/api/permissions/catalog` | 权限目录（Java 原生，来源 shared catalog JSON） |

其余未显式路由的 `/api/**` 仍走 NestJS legacy 兜底。

### 权限常量同步

Java 角色默认权限与 `shared/permissions.catalog.ts` 对齐：

```bash
cd backend
npm run sync:java-permissions   # PermissionConstants.java + permissions-catalog.json
```

## 与 NestJS 对齐

- API 前缀保持 `/api`
- 响应格式：`{ code: 0, message: "ok", data }`（见 `erp-common` 的 `ApiResponse`）
- JWT 密钥后续与 NestJS `JWT_SECRET` 共用，保证过渡期 token 互通

## 下一步

- [x] 网关切换：前端 `/api/` 指向 `erp-gateway:9000`，`migration` profile 已启用
- [x] `/api/auth/**` 已切到 Java `erp-auth-service`
- [ ] 迁移 `/api/users/**` 到 Java auth-service
- [ ] 各服务引入 Spring Data JPA，逐步迁移业务域
- [ ] 引入 Spring Cloud OpenFeign 处理服务间调用

### 验证 auth-service（本地）

```bash
# 确保 MySQL (3307) 与 NestJS 栈已运行
cd services
.\mvnw.cmd -pl erp-auth-service spring-boot:run

# 登录（默认账号见 backend seed，密码 123456）
curl -X POST http://localhost:9101/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"admin\",\"password\":\"123456\"}"
```

经网关（需 `SPRING_PROFILES_ACTIVE=migration`）：

```bash
curl -X POST http://localhost:9000/api/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"admin\",\"password\":\"123456\"}"
```
