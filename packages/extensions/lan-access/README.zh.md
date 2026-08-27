# @deepseek-ai/dsh-host-lan-access

[English](README.md) | 中文

局域网访问 webserver：普通 webserver 插件的子类。`DSH_LAN_ENABLED` 置位时绑定全网卡并在所有路径前加 token 门禁；未置位时与原版服务器逐字节一致。`web-app` bundle 的 `cordis.patch.yml` 用本包的行替换原版 `webserver` 行；原版行保留但禁用，反向切换（禁用本行、启用原版行）即可完整还原。

## 配置

| 环境变量 | 默认值 | 含义 |
|---|---|---|
| `DSH_LAN_ENABLED` | 未设（关） | 任意非空值开启 LAN 模式；`false`、空串、未设均为关。 |
| `DSH_LAN_BIND` | `0.0.0.0` | 开启时的绑定地址。schema 只认 `127.0.0.1` 与 `0.0.0.0` 两个字面量；其他值回退 `0.0.0.0`。 |
| `DSH_LAN_TOKEN` | — | 开启后必填的共享密钥。缺失时整个插件树 fail-loud 启动中止。 |
| `DSH_LAN_EXTRA_AUTHORITIES` | 未设 | 可选的逗号分隔 `host[:port]` 列表，追加到 `/api` 浏览器信任 fence 的 `trustedHosts`。 |

LAN 模式关闭时，行的 `host` 表达式就是原版的 `ctx.webStartup.host ?? '127.0.0.1'`——`--host`/`--port` 旗标行为与从前完全一致。

## 鉴权流程（全路径上锁）

每个请求——静态资源、`index.html`、`/api`、websocket 升级——都在任何已注册 handler 运行之前过 token 门禁：

- 无凭据 → 401，返回内联占位页（无脚本、无资源路径；不暴露真实 dist 的任何路径）。
- 任意路径带 `?token=<secret>` → 302 到同路径并清除查询参数。
- `/auth-set?token=<secret>` → 校验通过后设置 `dsh-lan-token=<secret>` cookie（`HttpOnly; SameSite=Lax; Path=/`，不加 `Secure`——明文 HTTP 场景），302 回 `/`。
- 有效 cookie → 请求放行到原版分派。
- 无效 token → 401。
- 无凭据的 websocket 握手在任何协议协商之前以 401 拒绝。

token 比较用 `crypto.timingSafeEqual` 比对 SHA-256 摘要，绝不比较明文。任何日志行都不打印含 token 明文的 URL。

## 安全警示

- **链路上全部明文。** 明文 HTTP 下，`?token=` 查询参数与 session cookie 均不加密传输；能嗅探局域网流量的人就能拿到 token。信任边界是局域网本身。
- **跨不可信网络必须套隧道。** 经由非可信网络访问时，用 SSH 隧道（`ssh -L 3180:127.0.0.1:3180 <host>`）或 HTTPS 反向代理包裹连接；不要把端口直接暴露到公网。
- **token 等于远程代码执行授权。** Web UI 可以创建运行 shell 命令的 agent 会话；请像对待这台机器的 SSH 私钥一样对待 token。
- 原版 `/api` 浏览器信任 fence（DNS rebinding 与跨站防御）完整保留；本包在其之上加鉴权，绝不替代它。

## `.ts` 源码直引的约束

组合行挂载的是 `@deepseek-ai/dsh-host-lan-access/src/server.ts`——源码面的子路径，不是构建产物入口。这依赖 dsh 源码启动走 tsx ESM 钩子（以及 profile 模块回退符号链接把该子路径解析到本 checkout 的 `src/`）。若组合将来只从构建产物运行，本包需要增加构建步骤，行的 `name` 也要改为裸包名。

## 验证流程

在运行 dsh 的机器上：

```sh
DSH_LAN_ENABLED=true DSH_LAN_TOKEN=<random> pnpm dsh --profile web --port 3180 --no-open
```

启动行会打印 LAN 地址。在同一局域网的另一台设备上：

- `http://<LAN-IP>:3180/?token=<random>` 应完整加载 UI（token 首次进入时换取 cookie 并清参）。
- 无凭据的 `curl -i http://<LAN-IP>:3180/api/session/list` 应返回 `401`。

测试：`packages/extensions/lan-access/tests/lan-access.spec.ts`（9 个用例：`/api` 门禁、websocket 拒绝、auth-set 链路、占位页不泄露、disabled 模式与原版逐字节对照——未设与显式 `false` 两态——缺 token fail-loud、日志卫生）。

## 模型体验

无，本包只是浏览器与原版服务器既有路由之间的 Web 分派包装器；没有任何内容到达模型请求。

#### KV 缓存影响

无；本包既不组装也不发送提供商请求。

## 已知限制与延后工作

- **明文传输** — token 查询参数、cookie 与全部页面流量都以明文穿过局域网；能嗅探该网段的人就能拿到 token。跨不可信网络必须套 SSH 隧道或 HTTPS 反向代理（见安全警示）。内置 TLS 模式刻意不在 fork 范围内。
- **单一共享 token、无吊销名单** — token 授权每一个持有它的设备，吊销即轮换 `DSH_LAN_TOKEN` 并重启。按设备发放凭据延后到有部署需要时再做。
- **无按路径策略** — 门禁对全部路径一揽子开关。把个别 API 方法限制在回环、同时向 LAN 提供页面是原版 fence 的职责（特权方法上游已限回环），不是本层的。
- **源码面行名** — 组合行直接挂载 `…/src/server.ts`，在 tsx 源码启动下可用，组合将来只从构建产物运行时会失效；届时本包增加构建步骤、行名改为裸包名。
