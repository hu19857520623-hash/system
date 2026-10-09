# ERP / OMS 应用缓存接入与上线

本次为两个后端接入可选 Redis 缓存，首批只缓存 Takealot 目的仓下拉列表。
代码已经修改到本地工作区，尚未同步到生产服务器。

## 实际行为

- ERP：内部查询 GET /api/takealot-dest-warehouses/oms/fulfillment 缓存数据库查询结果。
- OMS：GET /api/erp/takealot-dest-warehouses/fulfillment 缓存 ERP 返回的下拉列表。
- 所有原有登录、权限及 ERP 内部令牌校验保留在接口入口。
- 默认关闭，只有 REDIS_CACHE_ENABLED=true 才连接 Redis。
- 默认缓存 30 秒，加 0–5 秒随机偏移，缓存键分别使用 erp: 和 oms:。
- ERP 创建或修改目的仓配置成功后，增加共用失效版本，使两个系统的相关缓存失效。
- 缓存写入使用 Redis Lua 校验版本，避免失效前启动的查询重新填充旧缓存。
- Redis 未连接时立即走原数据源；命令超过 200 毫秒时回退，不排队等待重连。
- 同一进程内相同查询的并发请求合并，最多保留 128 个待完成查询。
- 缓存满导致写入报错时仍返回原数据源结果，兼容当前 Redis noeviction 策略。
- 原数据源自身失败时仍返回原接口错误，不将错误响应写入缓存。

这次没有缓存库存、余额、订单、登录身份或客户权限。试点降低目的仓下拉查询成本，
不会自动加速系统中的其他查询。两个后端各自包含缓存工具，确保它们现有独立 Docker
构建上下文都能打包；契约测试覆盖两个实现。

若失效时 Redis 不可用，已存在数据依靠 TTL 过期；两级缓存极端情况下可叠加至约 70 秒。
不要将该方案直接用于要求实时一致的业务数据。其他进程若直接修改目的仓数据库而
不经过 ERP 服务，也依靠 TTL 更新。

## 生产配置

先将修改后的源码、package.json、package-lock.json 和两个生产 Compose 文件同步到
服务器。仅编辑服务器 .env 不能使当前旧镜像自动获得缓存功能。当前工作区还有其他
未提交的业务修改，上线时需要按变更范围评审，不要直接发布整个工作区。

提供的 redis-cache-integration.patch 只包含本次缓存接入文件，不包含其他现有业务改动。
将补丁上传到服务器 /tmp/redis-cache-integration.patch 后，可先检查是否匹配当前源码：

~~~bash
cd /opt/system
git apply --check /tmp/redis-cache-integration.patch
~~~

检查失败时不要强制应用，应根据服务器源码版本调整。如果检查通过，使用现有源码
备份或版本管理保存现场，再应用补丁：

~~~bash
git apply /tmp/redis-cache-integration.patch
~~~

补丁应用只更新源码，不会更新正在运行的容器，仍需按下面步骤构建镜像。

在 /opt/system/erp/.env 和 /opt/system/oms/.env 中分别设置以下项目。
已有 REDIS_PASSWORD 时修改原项，不要添加重复键，也不要更换正在使用的密码。

~~~dotenv
REDIS_CACHE_ENABLED=true
REDIS_HOST=erp-redis
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD='现有Redis密码'
REDIS_CACHE_PREFIX=takealot:cache:v1:
~~~

密码必须是之前成功登录 Redis 的实际密码，按 dotenv 语法处理其中的引号、
美元符号、井号等字符。不要将真实密码提交到 Git 或截图发送。
ERP 与 OMS 的前缀必须一致，其他环境应使用不同前缀。

现有 Redis 应同时加入 erp_erp-network 和 takealot-production，且网络已写入
/opt/system/erp/docker-compose.redis.yml。保留当前 AOF、数据卷和内存设置。
无需重建 Redis 即可部署本次应用代码。

## 检查、构建和更新

以下命令只在代码已同步到服务器、网络配置完成后执行。先构建两个镜像，
确认都成功，再安排两个 API 容器的短暂更新窗口。
不要执行整套 down，不要添加 --remove-orphans，不需要执行数据库迁移。

~~~bash
cd /opt/system/erp
docker compose --env-file .env config -q
docker compose --env-file .env build erp-api

cd /opt/system/oms
docker compose --env-file /opt/system/erp/.env --env-file .env config -q
docker compose --env-file /opt/system/erp/.env --env-file .env build oms-api
~~~

两者均成功后：

~~~bash
cd /opt/system/erp
docker compose --env-file .env up -d --no-deps erp-api

cd /opt/system/oms
docker compose --env-file /opt/system/erp/.env --env-file .env up -d --no-deps oms-api
~~~

以上沿用生产文件的默认项目名（erp / oms）。若现场部署指定过其他项目名，
应沿用已有 com.docker.compose.project 标签值。构建保留源码验证，容器更新
会中断正在进行的连接，应在维护窗口执行。

## 验收

1. docker ps 检查 erp-api、oms-api 恢复健康，正常登录两个系统。
2. 在 OMS 打开使用 Takealot 目的仓下拉的页面，多次触发查询。
3. 进入 Redis 命令行（密码不出现在命令参数中）：

~~~bash
docker exec -it erp-redis redis-cli --askpass
~~~

执行：

~~~text
SCAN 0 MATCH takealot:cache:v1:* COUNT 100
TTL takealot:cache:v1:erp:takealot-dest:fulfillment
TTL takealot:cache:v1:oms:takealot-dest:fulfillment
INFO stats
~~~

SCAN 不是一次性全量查询，必要时继续使用返回游标。应出现相应数据键，
TTL 应为正数且不超过 35 秒。多次调用后，INFO stats 的 keyspace_hits
应增加（它是实例级累计值，也包含其他请求）。TTL=-2 表示当前键不存在，
可能尚未查询或已过期。

4. 通过 ERP 管理界面修改一个测试目的仓，确认 OMS 下一次查询拿到新配置。
5. 在独立测试环境验证 Redis 不可用时仍可查询；不要为测试而停止生产 Redis。
6. 验证未登录和无权限用户仍不能访问相关接口。

缓存服务不可用只影响缓存，不改变两个现有 API 健康检查的成功条件。
工具内部保留 hit/miss/error 计数用于代码诊断，没有增加公开诊断接口。

## 回退

将两个系统 .env 的 REDIS_CACHE_ENABLED 改为 false，再分别执行上述
up -d --no-deps 对应 API 的命令即可关闭缓存。代码和数据卷不需要删除，
现有缓存数据会按 TTL 过期。

## 本地验证命令

~~~powershell
cd D:\all\scripts
..\oms\node_modules\.bin\tsx.cmd --test test-application-cache.ts

cd D:\all\erp\backend
npm.cmd test -- --runTestsByPath src/modules/warehouse/takealot-dest.service.spec.ts
npm.cmd run build

cd D:\all\oms
npx.cmd tsc -p tsconfig.server.json
~~~

本地缓存测试使用内存替身验证过期、失效和并发，并使用本地 RESP 测试端点
验证真实 node-redis 客户端的命令超时；它不等同于生产 Redis 7 的端到端验收。
