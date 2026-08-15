# Spring 渐进迁移清单

## 接管条件

领域接口只有同时满足以下条件才能从“代理”标记为“已迁移”：

1. Java 端存在原生 Controller、Service 和持久化实现。
2. 权限、数据范围、错误 envelope 与 NestJS 契约一致。
3. 成功、校验失败、无权限、冲突和回滚场景有自动化测试。
4. 数据表和写入方责任明确。
5. Gateway 可单独回切到 NestJS。
6. 日志、健康检查、超时和告警已经配置。

## 当前状态

| 领域 | Java 原生状态 | Legacy fallback | 下一步 |
|---|---|---|---|
| Auth | 登录和个人资料已开始迁移 | 部分 | 补认证集成测试与密钥轮换 |
| Users/Permissions | 权限目录部分原生 | 是 | 完成用户写接口及契约对比 |
| CRM | 代理壳 | 是 | 先定义 leads/customer 数据所有权 |
| SCM | 代理壳 | 是 | 选择只读 products 查询作为首个切片 |
| Finance | 代理壳 | 是 | 在账单迁移前固化金额与事务测试 |
| Integration | 代理壳 | 是 | 先迁移无状态健康/同步查询 |

## 发布与回滚

- 每次只迁移一组资源路径。
- Gateway 路由切换与业务发布分开。
- 切换后保留可观测窗口，再移除 legacy fallback。
- 数据库变更遵循 expand、迁移、contract 顺序。
- 回滚时不得依赖已经删除的字段或旧 token 格式。
