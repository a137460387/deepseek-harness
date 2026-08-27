# Agent Note：lan-access 门禁的 opt-in localhost 免 token 豁免

Status: implemented

[English](2026-08-27-lan-access-localhost-exemption.md) | 中文

## 问题

在运行 dsh web 的机器本机使用门禁（本机浏览器、脚本自检）必须先走 `?token=` 或 `/auth-set` 换 cookie——对本地进程这一步纯属负担，token 的存在意义是网络对端。但本机同时跑着 cloudflared：隧道入站流量的 TCP 对端就是 127.0.0.1，任何单看「回环对端」的豁免都等于把公网也豁免掉。需要一个既方便本机、又不松开公网与 LAN 两种形态的豁免。

## 决策

`packages/extensions/lan-access/src/server.ts` 新增 `DSH_LAN_TRUST_LOCALHOST` 开关与双条件豁免：

- **默认关闭，取值从严。** 仅 `1`/`true`（大小写不敏感）生效；未设或任何其他值均为关闭，关闭时行为与豁免不存在时逐字节一致（开关只短路 token 判定分支）。
- **双条件同时满足才豁免。** a) TCP 对端是回环地址——`127.0.0.0/8`、`::1`、或归一化后的 `::ffff:127.x.x.x`（IPv4-mapped）；b) Host 头为回环形态——`localhost`、`127.0.0.0/8`、`[::1]`，均可带端口。Host 缺失或形态不可解析一律不满足。
- **反向隧道形态不在豁免之列。** cloudflared 入站请求的 TCP 对端是回环，但 Host 是公网域名（如 `dsh.lgyu.cloud`），Host 半条件不成立，token 判定保留——这正是豁免必须双条件的原因。LAN 形态（非回环对端）在对端半条件上失败。
- **判定只读 socket 对端。** `req.socket.remoteAddress` 是对端的唯一证据；`X-Forwarded-For` 等任何转发头都不进入判定——头部是攻击者可控文本，不能参与豁免。
- **判定点是门禁统一决策点。** request 包装与 upgrade 包装各自在既有 `requestCarriesToken` 判定处插入豁免检查，普通请求与 websocket 升级共用同一谓词；放行请求随后仍走原版 Host fence，cookie 会话流程（`/auth-set`、`?token=` 换 cookie）不动。
- **启动时读一次。** `Service.init` 把 `localhostBypassEnabled()` 快照进实例字段，与 `DSH_LAN_ENABLED`/`DSH_LAN_TOKEN` 同语义：改值需重启。

## 测试

`packages/extensions/lan-access/tests/lan-access.spec.ts` 新增 6 例（既有断言不动）：豁免放行页面与 websocket 升级（回环对端 + `localhost` / 127 形态 / `[::1]` 形态 Host）；隧道形态（`127.0.0.1` 对端 + 公网 Host）、伪造 `X-Forwarded-For`、无凭据 websocket 升级均 401 且有效 cookie 照常通过；LAN 对端以其自身地址为 Host 仍 401（含回环豁免正控制，把 401 归因于对端）；开关仅 `1`/`true`（大小写不敏感）生效、未设/`yes`/`2` 门禁不变；`isLoopbackTcpPeer` / `isLoopbackHostHeader` 两例谓词钉死接受/拒绝集合。没有真实 `::1` 对端的端到端用例：bind schema 只认 `127.0.0.1` 与 `0.0.0.0` 两个字面量，均为 IPv4 绑定，组合内不存在可达 `::1` 对端的配置——对端半分类由谓词用例钉死，Host 的 `[::1]` 形态由端到端用例钉死。

## 备选方案

**按对端单条件豁免。** 在本机部署下不成立：cloudflared 连向 `http://localhost:3080`，隧道流量的对端就是 127.0.0.1——按对端豁免即豁免公网。这是本特性的第一约束。

**信任回环 Origin 头，或经 `DSH_LAN_EXTRA_AUTHORITIES` 把 localhost 加白。** Origin 浏览器可控（部分客户端根本不发），且该白名单管的是 Host fence 的信任，不管「谁能跳过 token」。豁免的信任锚必须是传输层事实（socket 对端）+ 请求行声明（Host）。

**默认开启。** LAN 模式的姿态是「全网卡绑定必须鉴权」；默认豁免会让开启开关的部署静默收窄该姿态，且本机进程从此不可审计。默认关闭保持已启用语义不变。

## 后果

- 开启即把完整 agent 授权（RCE 级）交给本机全部进程——本机便利的代价，lan-access README「安全警示」节写明。
- 部署侧验收判据随开关变化：启用后本机回环自测无凭据从 401 变 200，公网隧道与 LAN 判据不变（登记于 FORK_NOTES.md「已知本地补丁」的 lan-access 条目）。
- NSSM 服务 `dsh-web` 不启用该开关；启用属人工批准的部署变更。
