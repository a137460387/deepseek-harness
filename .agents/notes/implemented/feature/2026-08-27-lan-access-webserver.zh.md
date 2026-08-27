# Agent Note：以带门禁的 WebServer 子类实现局域网访问 webserver

Status: implemented

[English](2026-08-27-lan-access-webserver.md) | 中文

## 问题

原版 web 组合只绑定回环地址，web 启动旗标也刻意拒绝 `--host 0.0.0.0`（未鉴权的全网卡绑定会把远程代码执行暴露给整个网络）。从局域网另一台设备访问 dsh web 因此每次都要先建 SSH 隧道。安全的 LAN 模式需要一层上游 webserver 没有的鉴权，覆盖每条路径——静态资源与 websocket 升级也不例外——同时不触碰上游自有文件（FORK_NOTES.md 既禁核心改动也禁包私有重写）。

## 决策

`packages/extensions/lan-access`（`@deepseek-ai/dsh-host-lan-access`）提供 `LanAccessWebServer`——原版 `WebServer` 插件的子类，由 web-app bundle 的 `cordis.patch.yml` 以替换行的形式挂载：

- **行内手术，不建补丁文件。** 原版 `webserver` 行置 `disabled: true`，紧邻插入 `lan-access-webserver` 行，config 的逐字段对照以注释内联在行旁（schema 只有 host/port 两个字段；port 不变，host 增加 LAN 表达式）。行的 `name` 是源码面子路径 `@deepseek-ai/dsh-host-lan-access/src/server.ts`，由 tsx 源码启动经 profile 模块回退符号链接解析——裸包名会装载构建入口而错过子类，`./src/...` 相对名则会解析到 profile 目录而非包内。
- **关闭时完全透明。** `DSH_LAN_ENABLED` 未设/false 时只运行基类 `Service.init`——不剥 listener、不校验、不 throw。disabled 模式测试用相同行分别 boot 原版服务器与子类，在普通请求、POST、404、坏 URL、upgrade 场景下逐字节比对状态码、响应体与头。
- **半配置 fail-loud。** enabled 而 `DSH_LAN_TOKEN` 缺失时 `Service.init` 直接 throw；Loader 以带标签的树装载失败暴露，进程 exit 1（已端到端验证）。
- **独占式分派接管。** enabled 模式经受控断言读取基类持有的 `http.Server`（基类字段私有；所有权仍归基类自身的 teardown effect），随后 `removeAllListeners('request'|'upgrade')` 并装回包装函数、由包装函数调用捕获的原件——`prependListener` 挡不住已注册的异步 handler。包装层在任何原 listener 之前对全路径设卡：无凭据 → 内联 401 占位页（无脚本、无 dist 路径）；`?token=` → 校验、设置会话 cookie（属性同 `/auth-set`）、302 到同路径并清参；`/auth-set?token=` → 校验、设置 `dsh-lan-token` cookie（`HttpOnly; SameSite=Lax; Path=/`）、302 回 `/`；有效 cookie → 放行；无凭据的 websocket 握手在任何协议协商之前 401。
- **常数时间比较与日志卫生。** token 校验用 `crypto.timingSafeEqual` 比对 SHA-256 摘要；任何日志行都不打印含 token 的 URL（测试在 spy console 下跑完成功、拒绝、错误三类路径后钉死）。
- **不动 fence。** 原版 `resolveLanTrust` 的 LAN 采样与 `/api` 浏览器信任 fence 保持上游原样——让真实绑定自己生效。`DSH_LAN_EXTRA_AUTHORITIES` 只是向 connection 行的 `trustedHosts` 表达式追加条目，即文档写明的额外 authority 组合缝隙。
- **组合遵循全部 fork 扩展约定：** `packages/extensions/` 落位、`./invariant` 伴生件、双语 README 与 i18n sidecar、版本对齐 root、`tsconfig.base.json` paths 登记、host 聚合 project reference、以及 `verify-cordis-config` 门要求的 bundle manifest `dependencies` 条目。

类上不声明 `static inject`——与基类一致，其 `webStartup` 注入来自组合行。类级 `inject` 会让 fiber 在任何不提供 `webStartup` 的上下文（手工构建的测试上下文）里 PENDING，第一轮测试即抓到。

## 测试

`packages/extensions/lan-access/tests/lan-access.spec.ts`——10 个用例，走真实 vendored Loader（与 webserver 包自身 spec 相同的 boot 形状）：无 token 时 `/api` 401 且 handler 从未被调用（spy）、websocket 握手无 token 被拒有 token 完成、`?token=` → 302 → `/auth-set` → Set-Cookie → 已鉴权 API/页面全链路、`?token=` 死循环闭环、占位 401 页对四条路径的不泄露、disabled 模式逐字节对照（未设与显式 `false`）、缺 token 的 fail-loud 启动、完整门禁会话的日志卫生、invariant 伴生件注册。端到端用真实 profile 启动在 3180 端口验证三种模式：enabled（401 / 302 / cookie / 鉴权放行、打印 LAN URL）、disabled（原版行为、无 LAN 行）、enabled 无 token（exit 1 带标签诊断）。

## 备选方案

**只用外部反向代理或 SSH 隧道。** 对不可信网络仍然正确（README 也如此建议），但 LAN 场景值得一等开关：信任边界已由局域网提供，隧道为每个设备增加一次设置步骤。

**在原版服务器前放独立代理进程。** 进程面翻倍、需要独立生命周期，且不重写路由表就无法对 websocket 升级路径设卡。

**补丁修改上游 webserver 包。** FORK_NOTES.md 把补丁排在插件缝隙实现之后；继承导出的 `WebServer` 能到达所有需要的缝隙（init 后从实例即可取到 `http.Server`），上游文件零 diff。

**`prependListener` 门禁。** Node 会运行所有已注册的 `request` listener；前置监听挡不住已注册的基类 handler 继续服务请求。接管必须先移除再包装。

## 后果

- web-app bundle 从此在所有组合中 boot `lan-access-webserver`；开关关闭时它就是换了行 id 的原版服务器。回退只需在一个补丁文件里改两行。
- token 是整个 LAN 网段的共享密钥——吊销即轮换 `DSH_LAN_TOKEN` 并重启。README 安全节写明明文传输与隧道要求。
- 源码面子路径行依赖 tsx 源码启动；组合将来若只从构建产物运行，本包增加构建步骤、行的 `name` 改为裸包名（README 已记录）。
