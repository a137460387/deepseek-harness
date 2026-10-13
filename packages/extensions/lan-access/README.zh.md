---
description: "局域网访问 webserver：原版 WebServer 的子类，启用时绑定一个具体局域网接口并加 token 门禁，未启用时与原版逐字节一致。"
kind: "package-reference"
---
# @deepseek-ai/dsh-host-lan-access

[English](README.md) | 中文

## 概述

局域网访问 webserver：普通 webserver 插件的子类，绑定一个具体的本机接口并在所有路径前加 token 门禁；未启用时与原版服务器逐字节一致。`web-app` bundle **默认禁用本行、保持原版 `webserver` 行启用**，因此部署方要用一份两行 patch overlay 禁用原版行、启用本行才能生效——见「启用 LAN 模式」。仅设置 `DSH_LAN_ENABLED=true` 不会改变任何行为：该 overlay 生效之前本行根本没被挂载。

## 目录

- [启用 LAN 模式](#enabling-lan-mode)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

## 配置

| 环境变量 | 默认值 | 含义 |
|---|---|---|
| `DSH_LAN_ENABLED` | 未设（关） | 任意非空值开启 LAN 模式；`false`、空串、未设均为关。只有在行被挂载之后才起作用：出厂组合里本行是禁用的，部署方必须同时套用[启用 LAN 模式](#enabling-lan-mode)里的 overlay。 |
| `DSH_LAN_BIND` | 首个非回环 IPv4 | 开启时的绑定地址。取本机任一接口的具体 IPv4/IPv6 字面量，也可以在明确只服务本机时使用回环字面量。未设即自动发现：子类绑定本机首个非回环 IPv4，因为基础 webserver 拒绝一次把所有网卡暴露在外的绑定。若本机没有任何非回环 IPv4，加载直接 fail-loud，绝不退回回环。 |
| `DSH_LAN_TOKEN` | — | 开启后必填的共享密钥。缺失时整个插件树 fail-loud 启动中止。 |
| `DSH_LAN_TRUST_LOCALHOST` | 未设（关） | 可选的 localhost 免 token 豁免；仅 `1`/`true`（大小写不敏感）生效，其余值与未设同为关闭。开启后的边界与代价见「安全警示」。 |
| `DSH_LAN_EXTRA_AUTHORITIES` | 未设 | 可选的逗号分隔 `host[:port]` 列表，追加到 `/api` 浏览器信任 fence 的 `trustedHosts`。 |

LAN 模式关闭时，行的 `host` 表达式就是原版的 `ctx.webStartup.host ?? '127.0.0.1'`——`--host`/`--port` 旗标行为与从前完全一致。LAN 模式开启时，`DSH_LAN_BIND` 才是绑定开关：行传入的是一个通过 schema 校验的回环占位值，因为行的 `!!js` 表达式在 Loader 作用域里求值、不带任何 import、无法枚举网卡，子类在 listen 之前把这个占位值替换掉。**`--host` 不能选 LAN 绑定地址**：它喂给 `webStartup.host`，而 LAN 模式恰好会替换掉那个行表达式。

<a id="enabling-lan-mode"></a>
## 启用 LAN 模式

bundle 出厂时原版 `webserver` 行启用、本包行禁用。因此启用 LAN 模式需要同时做两件事——一对给门禁用的环境变量，以及一份把本行挂上去、把原版行换下来的 patch overlay。单设 `DSH_LAN_ENABLED` 什么都不启用：行仍是禁用状态，原版服务器继续服务，绑回环且不带门禁。

在 checkout 之外写一份 overlay（一个文件、两行——禁用原版行、启用本行）：

```yaml
# lan-enable.overlay.yml
- id: webserver
  disabled: true
- id: lan-access-webserver
  disabled: false
```

然后用 `--patch` 启动，**置于首个 Web 应用旗标之前**：

```sh
DSH_LAN_ENABLED=true \
DSH_LAN_TOKEN=<random> \
DSH_LAN_BIND=<LAN-IP> \
  pnpm dsh --profile web --patch ./lan-enable.overlay.yml --port 3180 --no-open
```

`--patch` 是 launcher 旗标，而 launcher 遇到第一个不属于自己的 token 就停止读自己的选项。放在 `--port`（或任何 Web 应用旗标）之后，它会被透传给 Web 应用，启动直接报 `error: unknown option '--patch'`。务必排在应用旗标之前。

`DSH_LAN_BIND` 用来选网卡：

- **已设** —— 服务器原样绑定该地址。本机任一接口的具体 IPv4/IPv6 字面量都可用，在明确只服务本机时也可以用回环字面量。需要让其他设备访问的部署就设这个值。
- **未设** —— 子类自动发现本机首个非回环 IPv4。发现按 `os.networkInterfaces()` 的枚举顺序走、不按可用性排序，因此在装有虚拟网卡的主机上，它同样可能选中 WSL vEthernet、VMware host-only 或 VPN 接口，而不是物理 LAN 地址。需要让另一台物理设备访问时，请把 `DSH_LAN_BIND` 显式设为面向该设备的 IPv4，不要依赖自动发现。若本机报告没有任何非回环 IPv4，加载直接 fail-loud，绝不退回回环。

验证部署：

```sh
# The startup line names the address actually bound; confirm it against the OS.
netstat -ano | grep 3180        # Windows
ss -ltnp | grep 3180            # Linux

curl -i http://<LAN-IP>:3180/api/session/list   # 401 + inline placeholder page, no credential
curl -i http://127.0.0.1:3180/                  # connection refused: the gate binds the named interface, not loopback
```

- 启动行会打印 LAN URL 与宿主进程自己的启动令牌。若未设 `DSH_LAN_BIND` 而打印出的地址不是你要的那个，就是自动发现挑中了别的网卡——请显式设置 `DSH_LAN_BIND`。
- 无凭据访问任意路径 → `401` 加内联占位页。该页属于本门禁；宿主自己的浏览器鉴权返回的 `401` 是另一套正文（`dsh web authentication required…`），两层因此可区分。
- 浏览需要两段式入场：先打开 `http://<LAN-IP>:3180/?token=<DSH_LAN_TOKEN>`（本门禁种下 `dsh-lan-token` cookie），再打开启动行里的 `http://<LAN-IP>:3180/?token=<启动令牌>`（宿主自己的交换流程种下浏览器 cookie，应用加载）。详见下方鉴权流程。
- 在同局域网的另一台设备上 `curl -i http://LAN-IP:3180/` 应能到达门禁；若在那里连接被拒，说明绑定的接口该设备路由不到。

## 鉴权流程（全路径上锁）

每个请求——静态资源、`index.html`、`/api`、websocket 升级——都在任何已注册 handler 运行之前过 token 门禁：

- 无凭据 → 401，返回内联占位页（无脚本、无资源路径；不暴露真实 dist 的任何路径）。拒绝响应、`?token=` 重定向与 `/auth-set` 均标记 `Cache-Control: no-store`。
- 任意路径带 `?token=<secret>` → 校验通过后设置会话 cookie（属性同 `/auth-set`），302 到同路径并清除查询参数。
- `/auth-set?token=<secret>` → 校验通过后设置 `dsh-lan-token=<secret>` cookie（`HttpOnly; SameSite=Lax; Path=/`，不加 `Secure`——明文 HTTP 场景），302 回 `/`。
- 有效 cookie → 请求放行到原版分派。文档路径（dist 根与 `*.html`，GET/HEAD）额外携带 `Cache-Control: no-store`：渲染后的 index 内嵌实时 Host 状态（boot 主题与字号），前置缓存层——比如带缓存规则的 Cloudflare 隧道——绝不能缓存这个壳页面。内容哈希命名的资源与写请求不受影响。
- 有效 cookie 且带外来 `?token=` → 原样放行（不重定向、不种门禁 cookie）：见下方两段式入场。
- `DSH_LAN_TRUST_LOCALHOST=1/true` 时，TCP 对端与 Host 头均为回环形态的请求跳过 token 判定直接放行（普通请求与 websocket 升级走同一判定点）；`/auth-set` 与 `?token=` 换取 cookie 的流程不变。
- 无效 token → 401（无论是否携带外来 `?token=`，除非同时持有有效门禁 cookie）。
- 无凭据的 websocket 握手在任何协议协商之前以 401 拒绝。

token 比较用 `crypto.timingSafeEqual` 比对 SHA-256 摘要，绝不比较明文。任何日志行都不打印含 token 明文的 URL。

0.1.2-alpha.1 同步之后，宿主还运行自己的浏览器鉴权（Connection 的 BrowserAuth）：它以进程级启动令牌和 authority 绑定的 cookie 独立把守 `index.html` 与 `/api`，与本门禁互不知晓。浏览器入场因此分两段：

1. 访问 `/?token=<DSH_LAN_TOKEN>`——本门禁种下 `dsh-lan-token` cookie 并 302 回 `/`。
2. 访问 `/?token=<启动令牌>`——启动令牌由 `dsh web` 启动时打印（受监督部署中落在服务日志里）；携带门禁 cookie 的该请求原样穿过门禁，宿主自己的交换流程种下浏览器 cookie，应用加载。

未持门禁 cookie 的请求到不了第二段：外来 `?token=` 一律被拒。第二段令牌本身过不了本门禁；门禁 token 仍是外层边界。

## 安全警示

- **链路上全部明文。** 明文 HTTP 下，`?token=` 查询参数与 session cookie 均不加密传输；能嗅探局域网流量的人就能拿到 token。信任边界是局域网本身。
- **跨不可信网络必须套隧道。** 经由非可信网络访问时，用 SSH 隧道（`ssh -L 3180:127.0.0.1:3180 <host>`）或 HTTPS 反向代理包裹连接；不要把端口直接暴露到公网。
- **token 等于远程代码执行授权。** Web UI 可以创建运行 shell 命令的 agent 会话；请像对待这台机器的 SSH 私钥一样对待 token。
- **localhost 豁免默认关闭，开启等于信任本机全部进程。** 显式启用 `DSH_LAN_TRUST_LOCALHOST=1/true` 后，TCP 对端与 Host 头均为回环形态（localhost / 127.0.0.0/8 / `[::1]`，均可带端口）的请求跳过 token 判定直接放行，普通请求与 websocket 升级同判。边界：判定只依据 socket 对端真实地址与 Host 头，不读 `X-Forwarded-For` 等任何可伪造的转发头，因此反向隧道形态（回环对端 + 公网 Host，如 cloudflared 入站）与 LAN 形态（非回环对端）都不在豁免之列。代价：本机任何能连上该端口的进程或本地用户都直接获得完整 agent 授权（等价于持有 token），故默认关闭。
- 原版 `/api` 浏览器信任 fence（DNS rebinding 与跨站防御）完整保留；本包在其之上加鉴权，绝不替代它。

## `.ts` 源码直引的约束

组合行挂载的是 `@deepseek-ai/dsh-host-lan-access/src/server.ts`——源码面的子路径，不是构建产物入口。这依赖 dsh 源码启动走 tsx ESM 钩子（以及 profile 模块回退符号链接把该子路径解析到本 checkout 的 `src/`）。若组合将来只从构建产物运行，本包需要增加构建步骤，行的 `name` 也要改为裸包名。

## 验证流程

启用方式、overlay、启动命令与探针都见 [启用 LAN 模式](#enabling-lan-mode)。简言之：套用两行 overlay，传入 `DSH_LAN_ENABLED`/`DSH_LAN_TOKEN`/`DSH_LAN_BIND`，与操作系统核对实际绑定地址，并确认无凭据请求返回门禁的 `401`、而回环连接被拒。

测试：`packages/extensions/lan-access/tests/lan-access.spec.ts`（25 个用例：`/api` 门禁、websocket 拒绝、auth-set 链路、`?token=` 死循环闭环、占位页不泄露、文档 `no-store` 标记——文档、拒绝与换取响应携带；资源与写请求不带——disabled 模式与原版逐字节对照——未设与显式 `false` 两态，含响应头——缺 token fail-loud、日志卫生、localhost 豁免的双条件与 websocket 升级、隧道与 LAN 形态的维持门禁、豁免开关取值解析、回环分类谓词，以及 LAN 绑定解析：关闭时透传、显式 `DSH_LAN_BIND` 优先、发现结果覆盖行的占位值、监听器确实在被发现的接口上应答且不在回环上应答、以及本机无非回环 IPv4 时的 fail-loud 拒绝）。

<a id="model-experience"></a>
## 模型体验

无，本包只是浏览器与原版服务器既有路由之间的 Web 分派包装器；没有任何内容到达模型请求。

#### KV 缓存影响

无；本包既不组装也不发送提供商请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **明文传输** — token 查询参数、cookie 与全部页面流量都以明文穿过局域网；能嗅探该网段的人就能拿到 token。跨不可信网络必须套 SSH 隧道或 HTTPS 反向代理（见安全警示）。内置 TLS 模式刻意不在 fork 范围内。
- **单一共享 token、无吊销名单** — token 授权每一个持有它的设备，吊销即轮换 `DSH_LAN_TOKEN` 并重启。按设备发放凭据延后到有部署需要时再做。
- **无按路径策略** — 门禁对全部路径一揽子开关。把个别 API 方法限制在回环、同时向 LAN 提供页面是原版 fence 的职责（特权方法上游已限回环），不是本层的。
- **源码面行名** — 组合行直接挂载 `…/src/server.ts`，在 tsx 源码启动下可用，组合将来只从构建产物运行时会失效；届时本包增加构建步骤、行名改为裸包名。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
