# 工程架构与边界

## 当前形态

系统处于模块化单体向领域服务渐进迁移阶段：

```text
Browser
  -> Vue Web
  -> /api
  -> Spring Gateway（migration profile）
       -> 已迁移的 Java 接口
       -> NestJS legacy fallback
  -> MySQL / Takealot integration
```

NestJS 是当前主要业务实现。Spring 服务只有在完成接口、数据、测试和发布责任迁移后，
才能被视为对应领域的所有者；仅转发 NestJS 的服务仍属于迁移适配层。

## 依赖规则

### 前端

```text
pages -> features/composables -> api -> shared utilities
```

- 页面只负责路由级组合。
- 可复用业务计算放在 `src/features/<domain>/`。
- 网络、认证、响应 envelope 解码集中在 `src/api/`。
- 禁止页面自行持久化访问令牌或直接拼接后端基础地址。

### NestJS

```text
controller -> application service/policy -> Prisma and integrations
```

- Controller 必须使用 DTO 验证写入边界。
- Service 不负责建表或修改 Schema。
- 状态流转、费用和权限规则应抽成可测试 policy。
- 外部系统调用不得持有长数据库事务。

### Spring

- Gateway 只负责路由、横切策略和迁移切换，不实现业务规则。
- Java 领域服务不得长期作为多跳代理壳。
- 服务接管一个接口前，必须有与 NestJS 行为一致的契约测试。

## 数据所有权

迁移期仍共享 MySQL，但新增设计必须明确唯一写入方。一个资源切换到 Java 后，应停止
NestJS 对同一资源的新增写入能力，再逐步拆分 Schema 或数据库账号权限。

## 安全基线

- 生产环境必须显式提供 JWT 密钥、数据库凭据和 CORS 白名单。
- 浏览器主令牌只存当前会话；iframe 只接受同源消息。
- 数据转储和客户名单不得进入 Git。
- 生产容器默认不自动同步 Schema。
