# Takealot ERP 前端工程

南非海外仓经营系统前端，基于 Vue 3 + Vite + TypeScript + Element Plus 构建。

## 技术栈

- **框架**: Vue 3 (Composition API)
- **构建**: Vite
- **语言**: TypeScript
- **UI**: Element Plus
- **路由**: Vue Router
- **状态**: Pinia
- **样式**: SCSS

## 目录结构

```
frontend/
├─ dist/                 构建产物
├─ node_modules/         依赖
├─ src/
│  ├─ api/               后端接口封装
│  ├─ components/         页面组件
│  │  └─ common/         通用组件
│  ├─ composables/        Vue 组合式逻辑
│  ├─ constants/          常量配置
│  ├─ layouts/            页面布局
│  ├─ pages/              路由页面
│  ├─ router/             Vue Router
│  ├─ stores/             Pinia 状态管理
│  ├─ styles/             全局样式
│  ├─ App.vue             根组件
│  └─ main.ts             入口
├─ Dockerfile
├─ index.html
├─ package.json
├─ vite.config.ts
└─ README.md
```

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器（需先启动 backend，见 ../backend/README.md）
npm run dev

# 构建生产版本
npm run build

# 预览构建产物
npm run preview
```

开发模式下 Vite 会将 `/api` 代理到 `http://localhost:3000`（NestJS 后端）。

## Docker 部署

```bash
docker build -t erp-frontend .
docker run -p 80:80 erp-frontend
```

## 主要模块

| 模块 | 路由 | 说明 |
|------|------|------|
| 工作台 | `/dashboard` | KPI 概览、快捷入口 |
| 线索池 | `/leads/pool` | 客户线索管理 |
| 商品主数据 | `/products` | SKU 管理 |
| 采购订单 | `/purchase` | 采购全流程 |
| 库存查询 | `/inventory` | 库存实时查询 |
| 成本台账 | `/cost` | 成本核算 |
| 经营报表 | `/reports` | 数据分析 |
| 权限管理 | `/permissions` | 角色权限配置 |
