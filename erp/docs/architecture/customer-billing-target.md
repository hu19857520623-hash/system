# 网上获客 · 客户管理模块 — 流程图与架构设计

> 依据 `客户管理.xlsx`（订单跟进明细，约 3080 条线索）梳理，并对接现有 Takealot ERP PRD 边界。

---

## 1. Excel 现状摘要

| 维度 | 内容 |
|------|------|
| 数据量 | 约 3080 行线索，152 条成交 |
| 主渠道 | 抖音 1554 / 小红书 951 / 视频号 311 / 其他 259 |
| 留资方式 | 主动留资 2861 / 主动加 194 |
| 跟进状态 | 需再次跟进 1091 / 跟进中 905 / 无效 302 / 成交 152 / 没加上 134 / 暂无意向 93 / 意向高 45 |
| 店铺类型（成交） | 跨境店、本土店、海外仓、直邮、陪跑等组合套餐 |

**Excel 字段 → 系统字段映射：**

| Excel 列 | 系统实体 | 说明 |
|----------|----------|------|
| 客户名称 / 客户微信 / 联系方式 | `lead` 线索主档 | 去重键：手机号 / 微信号 |
| 客户获客来源 | `lead_source` | 投放人/引荐人（陈、彩云、转介绍等） |
| 渠道 | `channel` | 小红书 / 抖音 / 视频号 / 其他 |
| 留资方式 | `capture_type` | 主动留资 / 主动加 |
| 对接销售 | `owner_id` | 首次负责销售 |
| 再次对接销售 | `handoff_owner_id` | 二次跟进负责人 |
| 咨询时间 | `inquiry_at` | 首次咨询时间 |
| 前端情况 | `intent_tag` | 客户诉求标签（了解跨境、入驻、海外仓…） |
| 跟进状态 | `lead_status` | 状态机核心 |
| 销售备注 / 销售情况 | `follow_up_log` | 跟进记录（时间线） |
| 成交日期 / 成交时间 / 店铺类型 | `deal` | 成交单与套餐类型 |

---

## 2. 端到端业务流程图

```mermaid
flowchart TB
    subgraph 获客层["① 公域获客"]
        A1[小红书/抖音/视频号内容] --> A2[用户评论/私信/表单]
        A2 --> A3{留资方式}
        A3 -->|主动留资| A4[销售收到联系方式]
        A3 -->|主动加| A5[销售主动通过好友]
    end

    subgraph 录入层["② 线索录入 ERP"]
        A4 --> B1[创建线索 Lead]
        A5 --> B1
        B1 --> B2[去重校验<br/>手机/微信/渠道]
        B2 -->|重复| B3[合并或标记重复]
        B2 -->|新线索| B4[自动分配对接销售]
        B4 --> B5[状态: 新线索 → 跟进中]
    end

    subgraph 跟进层["③ 销售跟进"]
        B5 --> C1[记录前端情况/意向标签]
        C1 --> C2[添加跟进记录<br/>备注+销售情况]
        C2 --> C3{跟进结果}
        C3 -->|加微未通过/账号错误| C4[需再次跟进 / 没加上]
        C3 -->|已加未回复| C5[跟进中 / 需再次跟进]
        C3 -->|明确拒绝/服务商/竞品| C6[无效客户]
        C3 -->|观望| C7[暂无意向· nurture 池]
        C3 -->|高意向| C8[意向高]
        C4 --> C9{是否转派}
        C5 --> C9
        C8 --> C9
        C9 -->|是| C10[再次对接销售]
        C10 --> C2
    end

    subgraph 成交层["④ 成交转化"]
        C8 --> D1[报价/方案确认]
        C5 --> D1
        D1 --> D2[选择店铺类型/套餐<br/>本土店/跨境店/海外仓/陪跑]
        D2 --> D3[状态: 成交]
        D3 --> D4[填写成交日期]
    end

    subgraph 内部闭环["⑤ ERP 内部归档（不推送 OMS/WMS）"]
        D3 --> E1[写入成交记录 deal]
        E1 --> E2[可选：关联 ERP 财务客户档案]
        E2 --> E3[内部销售报表 / 漏斗统计]
    end

    C6 --> Z1[线索归档·不可再分配]
    C7 --> Z2[定时唤醒·再次跟进任务]
```

---

## 3. 线索状态机

```mermaid
stateDiagram-v2
    [*] --> 新线索: 录入/导入

    新线索 --> 跟进中: 销售首次联系
    新线索 --> 没加上: 联系方式无效

    跟进中 --> 需再次跟进: 未回复/未通过
    跟进中 --> 意向高: 明确购买意向
    跟进中 --> 暂无意向: 观望/后期再做
    跟进中 --> 无效客户: 竞品/白嫖/删除
    跟进中 --> 成交: 签约付款

    需再次跟进 --> 跟进中: 再次触达成功
    需再次跟进 --> 没加上: 多次失败
    需再次跟进 --> 无效客户: 确认放弃
    需再次跟进 --> 成交: 转化成功

    意向高 --> 成交: 签约
    意向高 --> 跟进中: 暂缓决策
    意向高 --> 暂无意向: 价格/时机原因

    暂无意向 --> 需再次跟进:  nurture 唤醒
    没加上 --> 需再次跟进: 换联系方式重试
    没加上 --> 无效客户: 放弃

    成交 --> [*]: 内部归档
    无效客户 --> [*]: 归档
    无需对接 --> [*]: 归档
    搜不到 --> 无效客户: 确认无效
```

**与 Excel 状态对齐：**

| Excel 跟进状态 | 系统状态码 | 是否可编辑 | 是否计入漏斗 |
|----------------|------------|------------|--------------|
| 跟进中 | `following` | 是 | 是 |
| 需再次跟进 | `recall` | 是 | 是 |
| 意向高 | `hot` | 是 | 是 |
| 成交 | `won` | 锁定 | 是（转化） |
| 无效客户 | `invalid` | 锁定 | 否 |
| 暂无意向，等后期开发 | `nurture` | 是 | 是（培育池） |
| 没加上 | `no_contact` | 是 | 是 |
| 无需对接 | `no_need` | 锁定 | 否 |
| 搜不到 | `not_found` | 是 | 否 |

---

## 4. 系统总体架构

```mermaid
flowchart TB
    subgraph 用户层
        U1[销售/客服]
        U2[销售主管]
        U3[管理层]
        U4[系统管理员]
    end

    subgraph ERP_获客模块["ERP · 获客与客户中心（新增）"]
        M1[线索池 Lead Pool]
        M2[跟进工作台]
        M3[成交转化]
        M4[客户档案·财务侧]
        M5[获客报表/漏斗]
        M6[分配规则引擎]
    end

    subgraph ERP_现有模块["ERP · 现有模块"]
        P1[商品主数据]
        P2[供应商/采购]
        P3[成本台账]
        P4[客户结算/应收]
        P5[权限与审计]
    end

    subgraph 集成层
        I1[API 网关]
        I2[消息队列]
        I3[同步日志/幂等]
        I4[定时任务<br/>唤醒/超时提醒]
    end

    subgraph 外部渠道
        E1[小红书/抖音/视频号<br/>手动录入或 API 留资]
        E2[企业微信/个人微信<br/>备注回写]
    end

    U1 --> M2
    U2 --> M6
    U3 --> M5
    U4 --> P5

    E1 -->|留资 webhook / 批量导入| M1
    E2 -->|跟进备注| M2

    M1 --> M6 --> M2
    M2 --> M3
    M3 --> M4
    M4 --> P4
    M4 -.->|客户 ID 关联| P2
    M4 -.->|账单主体| P4

    I4 --> M2

    Note2[成交转化 M3 为 ERP 内部模块<br/>不触发 OMS/WMS 同步]
```

---

## 5. 模块边界（与现有 PRD 的关系）

| 对象 | 获客模块（新增） | ERP 现有职责 | OMS 职责 |
|------|------------------|--------------|----------|
| 线索 Lead | **主责**：录入、分配、跟进、状态 | 不管理 | 不管理 |
| 销售跟进记录 | **主责** | 审计日志引用 | — |
| 成交/套餐 | **主责**：内部记录成交事实与套餐类型 | 不直接管理 | 不推送、不管理 |
| 财务客户档案 | 可选内部关联 | **主责**：账期、信用、开票 | 展示门户（独立流程） |
| 订单/发货/结算 | — | **主责** | 客户下单 |

> **边界说明**：获客与成交转化是 **ERP 内部销售运营模块**，成交后不向 OMS/WMS 推送。OMS/WMS 的客户开通、店铺绑走各自独立流程，与成交模块解耦。

---

## 6. 核心数据模型

```mermaid
erDiagram
    LEAD ||--o{ FOLLOW_UP_LOG : has
    LEAD ||--o| DEAL : converts_to
    DEAL ||--o| CUSTOMER_FINANCE : may_link
    CUSTOMER_FINANCE ||--o{ CUSTOMER_BILL : generates

    LEAD {
        string lead_id PK
        string customer_name
        string wechat_id
        string contact_phone
        string source_person
        string channel
        string capture_type
        string owner_id FK
        string handoff_owner_id FK
        string status
        string intent_tags
        datetime inquiry_at
        bool is_duplicate
    }

    FOLLOW_UP_LOG {
        string log_id PK
        string lead_id FK
        string operator_id
        string sales_situation
        string remark
        datetime created_at
    }

    DEAL {
        string deal_id PK
        string lead_id FK
        string shop_type
        date deal_date
        datetime won_at
        decimal amount
        string package_code
    }

    CUSTOMER_FINANCE {
        string customer_id PK
        string lead_id FK
        string bill_period
        decimal credit_limit
        string invoice_info
        string status
    }

    ASSIGNMENT_RULE {
        string rule_id PK
        string channel
        string source_person
        string default_owner_id
        int daily_quota
    }
```

---

## 7. 销售跟进时序（单条线索）

```mermaid
sequenceDiagram
    participant 渠道 as 公域渠道
    participant 销售 as 销售
    participant CRM as ERP·线索模块
    participant 主管 as 销售主管
    participant ERP as ERP·客户档案

    渠道->>销售: 留资/加微
    销售->>CRM: 新建线索（或批量导入）
    CRM->>CRM: 去重 + 自动分配 owner
    CRM-->>销售: 待跟进任务

    loop 跟进循环
        销售->>CRM: 更新状态/备注/销售情况
        alt 需转派
            销售->>主管: 申请转派
            主管->>CRM: 指定再次对接销售
        end
        CRM->>CRM: 超时未跟进 → 提醒
    end

    销售->>CRM: 标记成交 + 店铺类型
    CRM->>CRM: 写入成交记录（内部归档）
    opt 需要财务结算时
        CRM->>ERP: 手动/可选关联财务客户档案
        ERP-->>销售: 客户编号 Cxxx
    end
    Note over CRM: 不向 OMS/WMS 推送<br/>采购/结算走 ERP 既有主链路
```

---

## 8. ERP 侧边栏菜单建议

```
概览
  └─ 工作台（新增：今日待跟进、成交漏斗 KPI）

获客与销售          ← 新增一级模块
  ├─ 线索池          （列表/筛选/批量导入）
  ├─ 我的跟进        （销售个人工作台）
  ├─ 成交管理        （已成交客户、店铺类型）
  └─ 获客报表        （渠道转化、销售排行、漏斗）

产品开发 / 采购 / 财务 …（现有模块不变）
  └─ 客户结算        （关联 customer_id，从成交转入）
```

---

## 9. 关键接口清单（新增）

| 编号 | 方向 | 说明 | 触发时机 |
|------|------|------|----------|
| INT-CRM-001 | 渠道 → ERP | 留资 webhook / Excel 导入 | 新线索产生 |
| INT-CRM-002 | ERP 内部 | 线索 → 成交记录归档 | 线索状态 = 成交 |
| INT-CRM-003 | ERP 内部 | 成交 → 财务客户档案（可选关联） | 人工确认需结算时 |
| INT-CRM-004 | ERP → 企微 | 跟进提醒/待办推送（可选） | 需再次跟进超时 |

> **不含** ERP → OMS / ERP → WMS 接口。成交转化不触发下游系统同步。

---

## 10. 报表指标（对应管理需求）

| 指标 | 计算口径 |
|------|----------|
| 渠道获客量 | 按 channel 分组 count(lead) |
| 加微通过率 | 已加微信 / (已加 + 加微未通过 + 账号错误) |
| 漏斗转化率 | 成交 / 有效线索（排除无效、搜不到） |
| 销售人效 | 按 owner / handoff_owner 统计跟进量、成交量 |
| 平均成交周期 | won_at - inquiry_at |
| 套餐分布 | 按 shop_type 统计成交结构 |
| 培育池唤醒率 | nurture → recall/won 比例 |

当前 Excel 粗算：**总线索 ~2750 有效状态记录，成交 152，转化率约 5.5%**（与渠道/销售维度下钻后可做基准线）。

---

## 11. 分期实施建议

| 阶段 | 范围 | 说明 |
|------|------|------|
| **P1-A** | 线索 CRUD + 状态机 + 跟进记录 + Excel 导入 | 替代现有表格，3080 条历史数据迁移 |
| **P1-B** | 分配规则 + 待跟进提醒 + 基础漏斗报表 | 提升销售效率 |
| **P1-C** | 成交内部归档 + 可选关联财务客户 | 与 PRD P1 客户结算弱耦合，不自动推送 |
| **P2** | 企微集成、渠道 API 留资、nurture 自动唤醒 | 减少手工录入 |

---

## 12. 权限设计

| 角色 | 线索池 | 他人线索 | 成交确认 | 获客报表 | 分配规则 |
|------|--------|----------|----------|----------|----------|
| 销售 | 读写自己的 | 只读 | 自己的 | 个人 | — |
| 销售主管 | 全部 | 读写 | 全部 | 团队 | 配置 |
| 管理层 | 只读 | 只读 | 只读 | 全部 | 只读 |
| 财务 | — | — | 只读 | 成交汇总 | — |
| 系统管理员 | 全部 | 全部 | 全部 | 全部 | 全部 |

---

*文档版本：V0.2 · 2026-06-12 · 成交转化为 ERP 内部模块，不推送 OMS/WMS*
