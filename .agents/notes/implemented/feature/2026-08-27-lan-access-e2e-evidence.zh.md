# Agent Note: LAN-access 验收冒烟证据（三态）

Status: implemented

[English](2026-08-27-lan-access-e2e-evidence.md) | 中文

## 问题

lan-access 插件在另一台机器交付；验收交接要求在本机以真实进程取证三个开关状态均符合规格（enabled 门禁链路、disabled 对原版服务器透明、enabled 缺 token fail-loud），并且先排除 fork 已两次踩中的旧进程隐患（host 层替换前启动的长驻 `dsh web` 会继续服务旧树）。

## 决策

取证时间 2026-08-27，本 Windows 主机，端口 3180；启动前经 `netstat` 定位并 `taskkill` 终止了一个早于本次改动的旧 `dsh web`（PID 24428，8/26 14:45 启动，监听 3080）。每次运行的完整日志在交付会话中；下述为记录的输出。

**S1 —— `DSH_LAN_ENABLED=true` 且设 token。** 启动行打印 LAN URL（`resolveLanTrust` 从真实全网卡绑定采样）。无凭据 `/api/session/list` → `401` + `text/html` 内联占位页。入口 `/?token=<t>` → `302` 回 `/` 且查询参数已清除。`/auth-set?token=<t>` → `302` + `set-cookie: dsh-lan-token=<t>; HttpOnly; SameSite=Lax; Path=/`。带 cookie 的真实 RPC 信封（`POST /api/settings.describe`，`application/json`）→ `200` + JSON `server-response`；同 POST 无 cookie → `401`。（带 cookie 对未知 method 的 GET 返回 API 层自身的 `404 text/plain`——门禁已放行的判据是与无 cookie 的 `401` HTML 页在状态码与 content-type 上的分叉。）

**S2 —— 开关未设。** 启动行无 LAN 后缀。`GET /` → `200 text/html`（dist 正常服务）；`GET /api/session/list` → `404 text/plain`；`GET /?token=anything` → `200`（无门禁、无重定向）；`POST /api/settings.describe` → `200`。

**S2b —— 原版服务器交叉对照。** 经两行互换的 `--patch` overlay 重新启用上游 `webserver` 行后，同样四项请求与 S2 逐项一致。该次运行同时暴露并验收了行形状修正：交付初版把 stock 行删成只剩 `disabled: true`，互换 overlay 启动即 `Cannot read properties of undefined (reading 'startsWith')` 失败；已提交的行在 `disabled: true` 旁保留 stock `name`/`inject`/`config`，overlay 正常启动且响应一致。

**S3 —— enabled 缺 token。** 进程 exit `1`，带标签诊断：`dsh: plugin tree failed to load: ... DSH_LAN_TOKEN is required when DSH_LAN_ENABLED is set; refusing to bind all interfaces without an access token`。无端口监听残留。

## 备选方案

**以单元测试充当验收证据。** 单元测试经真实 vendored Loader 钉住了同样的行为，但交接要求真实进程冒烟（profile 启动、tsx 装载、实际 curl 响应）——disabled 逐字节声明与旧进程隐患只在组合进程层显形。

**跳过原版服务器交叉对照。** 单元测试在单进程内比对子类与原版类；overlay 运行额外证明 bundle 的两行可被外部 patch 互换——正是 patch 文件注释承诺的回退路径。

## 后果

- 三态验收以记录输出完成；行形状修正（disabled 行保留 stock 字段）已折入四笔主序列的 scaffold 笔。
- 今后涉 webserver/host 层的改动应在任何冒烟前重跑 netstat 旧进程检查；本 Note 记录了该模式第三次在造成伤害前被抓住。
