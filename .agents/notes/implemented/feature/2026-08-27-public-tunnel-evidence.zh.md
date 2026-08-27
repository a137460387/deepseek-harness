# Agent Note: 公网隧道暴露证据(stock 栈与门禁栈)

Status: implemented

[English](2026-08-27-public-tunnel-evidence.md) | 中文

## 问题

在把 `dsh web` 经公网 HTTPS 隧道暴露之前,两个问题需要本机真实进程取证:stock 部署姿势经 Cloudflare quick tunnel 是否已构成未鉴权的公网可达面;fork 的 lan-access token 门禁是否端到端覆盖隧道流量(页面、RPC、websocket 升级)且不破坏特权 pin 的回环豁免。次要问题:rc.2 浏览器审计中的 `crypto.randomUUID` 顾虑在隧道场景是否成立。

## 决策

取证时间 2026-08-27,本 Windows 主机,commit `723b224297`(`pnpm install` 与 `pnpm run build` 均 exit 0),端口 3180,stock 与 fork 栈分开运行。下述探针输出均为记录到的响应;token 与 cookie 值已脱敏。

**stock 栈判别——结论:被 fence 拦但不可用,未裸奔。** stock `dsh web`(无 `--trusted-host`)经 quick tunnel 对每个 `/api` 探针均 `403`:

| 探针 | 请求 | 状态码 | 响应体 |
|---|---|---|---|
| 0 | 本地 `POST http://127.0.0.1:3180/api/settings.describe`,无伪造头 | `200` | 完整 settings JSON |
| a | 隧道域名,无伪造头 | `403` | `forbidden` |
| b | 隧道 + `Origin: http://127.0.0.1:3180` | `403` | `forbidden` |
| c | 隧道 + Origin + `Host: 127.0.0.1:3180` | `403` | Cloudflare 边缘 HTML 错误页(`Server: cloudflare`) |

探针 0 与 a/b 对照把因果链钉死在 Host 头处理层:同一请求本地成功、隧道失败,唯一差异是到达时的 Host。代码归因:`isTrustedApiRequest`([api-request-trust.ts](../../../../packages/client/connection/src/api-request-trust.ts))对**每一个** `/api` 请求执行 Host fence——只认回环 hostname 或已声明的 `trustedHosts` 条目——stock 启动不声明任何条目,而 cloudflared 默认把隧道域名作为 Host 透传,fence 全拒。探针 c 证明残余伪造路线在更早一层即被关闭:把 Host 改写成回环授权会使 Cloudflare 边缘自身拒绝请求(`Server: cloudflare` HTML 页),根本到不了 origin。结论:stock 姿势经 quick tunnel 是 H1——无未鉴权公网 API 面,但同样不可用。

**fork 栈配方。** 启动顺序是硬依赖:quick tunnel 域名每次 cloudflared 重启即变,因此顺序为(1)对 `http://127.0.0.1:3180` 启动 cloudflared 并从注册行抓域名,(2)以 `DSH_LAN_ENABLED=true` 加新生成的 `DSH_LAN_TOKEN`(仅进程环境注入)启动 `dsh web --port 3180 --no-open --trusted-host <隧道域名>`。`--trusted-host` 必需:fork 绑全网卡,`resolveLanTrust` 自动派生 LAN IP 信任,隧道域名若不显式声明则不在信任表内。经隧道域名的五发探针(curl + cookie jar 走完整握手链):

| 探针 | 请求 | 期望 | 实际 |
|---|---|---|---|
| a | `GET /` 无凭据 | `401` | `401` 门禁占位页 |
| b | `GET /?token=<t>` | 记录性 | `302` 回 `/`,无 `Set-Cookie` |
| b2 | `GET /auth-set?token=<t>` | `302` + cookie | `302` + `set-cookie: dsh-lan-token=<t>; HttpOnly; SameSite=Lax; Path=/` |
| c | cookie `POST /api/session.list` | `200` | `200` + 真实会话 JSON |
| d | cookie `POST /api/settings.describe` | `403` | `403` `forbidden` |

先行的本地自检在无 `--trusted-host` 下验证了同一链路:裸 `/` → `401`,`/auth-set?token=` → `302` + cookie,cookie `POST /api/session.list` → `200`,以及回环下 cookie `POST /api/settings.describe` → `200`——装上门禁后特权 pin 保留回环豁免,证明门禁没有过度拦截原生特权语义。

**浏览器流,两段。** 主流程从 `/auth-set?token=<t>` 进入:cookie 落地,SPA 完整渲染(工作区树、与 `session.list` 数据一致的真实会话侧栏、模型选择器有值),54 个插件 bundle 与 30+ 个 RPC 成功,诊断性 `wss://…/api/events.mux` 连接完成 upgrade 并收到真实 mux 帧,console 零 `crypto.randomUUID`/`SecurityError` 报错——客户端 RPC 用基于 `getRandomValues` 的 UUID helper,不依赖安全上下文,且 HTTPS 隧道本身就是安全上下文。记录流从无 cookie 上下文进入裸 `/?token=<t>`:服务器 `302` 剥除 query 且不设 cookie,浏览器落地 `/` 得 `401`——死循环:401 页自己的指引("追加 ?token= 即可登录")原路指回自己。唯一可用入口是 `/auth-set?token=`。

## 备选方案

**只做隧道 403 探针,不做本地对照。** 没有探针 0,隧道的 403 理论上也可能只是服务器侧什么都服务不了;本地 `200` 把拒绝归因精确钉在 Host 层,stock 姿势才可证为"被 fence",而非"坏了"。

**只用 curl 探针判定门禁。** 浏览器两段补上了 curl 观察不到的东西:websocket 升级经 trusted-host fence 成功(curl 不在此处说 WS 握手)、SPA 在隧道延迟下真实组合装载、`/?token=` 死循环以用户可见的失败形态显形而非仅是响应头观察。

**顺手修掉 `/?token=` 的 cookie 缺口。** README"首次进入时换取 cookie"的描述与实现不符——`/?token=` 只剥 query;只有 `/auth-set` 设 cookie。本任务是只读取证;修复延后为独立改动,并在下方记为已知限制。

## 后果

- stock 栈经 quick tunnel 确认为被拦但不可用(H1);fork 栈以 `--trusted-host` 加 token 门禁是受支持的公网隧道姿势,门禁先于 Host fence 应答(无凭据是 `401` 而非 `403`——门禁覆盖含静态资源与升级在内的隧道流量)。
- 已知限制,记录而非绕过:(a) 特权域(`settings.*`、`credentials.*`)远程一律 `403`——特权 pin 设计上仅限回环,`--trusted-host` 不豁免;(b) quick tunnel 域名每次重启即变,`--trusted-host` 须随之重配;(c) `/?token=` 死循环——README 文案承诺了实现不执行的 cookie 交换;`/auth-set?token=` 是唯一可用入口,修复刻意延后为独立改动;(d) `crypto.randomUUID` 顾虑在隧道场景不成立(零报错,`getRandomValues` 实现),但纯 HTTP LAN 场景未测。
- fork 栈公网 quick tunnel 的安全姿势:token 门禁单因素保护 + 特权 pin 纵深;本 Note 与存档探针记录中的全部 token 与 cookie 值均已脱敏——不记录任何明文秘密。
