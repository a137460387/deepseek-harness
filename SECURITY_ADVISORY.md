# SECURITY_ADVISORY.md — dsh 安全通告:QVD-2026-57410(lan-access `?token=` 登录死循环)

本仓库(fork)的安全通告,记录已修复的缺陷 QVD-2026-57410:lan-access token 门禁的 `?token=` 登录入口无法建立会话,形成登录死循环。独立文件,与 DEPLOY_TUNNEL.md 同级同风格,不进 docs 门控体系。

| 项 | 值 |
|---|---|
| 缺陷编号 | QVD-2026-57410 |
| 受影响组件 | `packages/extensions/lan-access`(fork 扩展,非上游代码) |
| 危害定性 | 低:认证流程可用性缺陷 + 凭据暴露面扩大;不是认证绕过 |
| 修复 commit | `c9cdd50356`(2026-08-27 19:26) |
| 通告日期 | 2026-08-27 |

## 1. 摘要

QVD-2026-57410 是本 fork lan-access token 门禁中的认证会话建立缺陷:文档承诺的 `?token=` 登录入口以 302 应答清除查询参数但不设置会话 cookie,浏览器落地干净 URL 后无凭据,收到 401;401 占位页的指引(追加 `?token=` 即可登录)又指向同一入口,形成登录死循环。后果是合法用户无法经文档入口完成登录,且按指引的反复重试使 token 以 URL 查询参数形态多次进入浏览器历史与访问日志;修复前唯一可用入口(`/auth-set`)同样经 URL 传递 token。缺陷不构成认证绕过——修复前后,未持有 token 的请求始终得到 401。影响范围限于本 fork 在 `DSH_LAN_ENABLED=true` 下、经 `?token=` 入口首次登录的部署;上游原版不含该代码路径,不受影响。缺陷已于 2026-08-27 由 commit `c9cdd50356` 修复(入口 302 补齐会话 cookie),修复版当日在持续运行的公网隧道部署中验证生效;fork 处于 pre-release、无外部消费者,当前无已知暴露。

## 2. 缺陷细节

### 2.1 类别

认证会话建立缺陷:公开登录入口的认证流程无法完成,伴随凭据暴露面扩大。属于会话管理实现与文档承诺不一致的问题,不是鉴权决策缺陷——门禁对无凭据请求的拒绝路径在修复前后行为一致。

### 2.2 根因

门禁对"任意路径携带 `?token=` 查询参数"的应答是 302 重定向到同路径并清除查询参数,但该重定向不设置会话 cookie;会话 cookie 的设置只存在于 `/auth-set` 一条路径。README 承诺"首次进入时换取 cookie"的入口方式因此无法完成认证:浏览器跟随 302 落地干净 URL 时没有任何凭据,得到 401 占位页,而占位页的指引把用户指回同一入口——登录死循环。

机制层面的凭据暴露:token 经 URL 查询参数传递会进入浏览器历史与访问日志。死循环使用户按指引反复重试,凭据以 URL 形态多次落盘,扩大了这一固有暴露面。

### 2.3 触发条件

以下条件同时满足时触发:

- `DSH_LAN_ENABLED=true`(门禁开启;关闭时该扩展与原版服务器逐字节一致,已由测试钉死);
- 用户按 README 或 401 页指引,以 `?token=` 查询参数形式访问入口;
- 浏览器没有既有的有效会话 cookie。

## 3. 影响范围

- **版本区间:**引入于 `46eaf37299`(2026-08-27 13:02,lan-access 落地),修复于 `c9cdd50356`(2026-08-27 19:26)。fork 处于 pre-release、无外部消费者,已知受影响部署仅维护者本人的一台公网隧道部署,暴露窗口约 6.5 小时。
- **配置条件:**仅 `DSH_LAN_ENABLED=true` 且经 `?token=` 入口首次登录的会话受影响;disabled 模式、`/auth-set` 入口、已持有 cookie 的会话均不受影响。
- **上游原版:**不受影响。缺陷位于 fork 扩展包,上游文件零改动(README 顶部横幅为登记例外,见 FORK_NOTES.md)(FORK_NOTES.md 既禁核心改动也禁包私有重写)。
- **危害评估(克制):**门禁本身未被绕过,后果是合法用户无法经文档入口登录(可用性),以及凭据在浏览器历史与访问日志中的暴露面扩大。评估暴露面严重性时的语境:token 等价于完整 agent 能力面的授权——Web UI 可创建运行 shell 命令的 agent 会话(lan-access README 安全警示原文为"token 等于远程代码执行授权");模型层安全对齐可被绕过在公开研究中多有记录,token 因此是该部署唯一且不可分的访问控制点,其暴露面的收敛值得关注。

## 4. 修复与缓解

### 4.1 fork 内修复

commit `c9cdd50356`(fix(fork): close the ?token= sign-in dead loop,2026-08-27 19:26):

- 入口 302 应答补齐 `Set-Cookie`,属性与 `/auth-set` 一致:`HttpOnly; SameSite=Lax; Path=/`(不加 `Secure`,兼容明文 HTTP 局域网场景;传输机密性由部署侧 TLS 提供,见 4.2)。
- 测试钉死闭环链:`?token=` → 302 + Set-Cookie → 干净 URL 带 cookie → 200 真实页面;无效 token 不设 cookie。
- README 与 Agent Note 同步更新为与实现一致的描述。

### 4.2 门禁机制(DSH_LAN_*)对该攻击面的覆盖与适用条件

先厘清归属:`DSH_LAN_*` 门禁位于本仓库的 lan-access 扩展(经 `cordis.patch.yml` 替换行挂载),不是上游原版机制。两层机制对该攻击面的覆盖与条件:

| 机制 | 覆盖 | 适用条件 |
|---|---|---|
| 上游默认姿态:仅回环绑定、拒绝未鉴权全网卡绑定、`/api` Host fence、特权域仅回环 | 未声明公网 trusted-host 的部署经公网隧道探针全部 403——无未鉴权公网 API 面(2026-08-27 取证,见参考) | 攻击者无法使请求携带受信 Host 到达 origin(取证中向回环 Host 的伪造在 Cloudflare 边缘即被拒);代价是远程同样不可用,属设计使然 |
| `DSH_LAN_*` 门禁(fork) | 全路径(静态资源、`/api`、websocket 升级)先于 Host fence 应答;无凭据 401,token 校验为 SHA-256 摘要 + 常数时间比较 | `DSH_LAN_ENABLED=true` 且 `DSH_LAN_TOKEN` 已设置;公网隧道部署需显式声明信任域名(`--trusted-host` / `DSH_LAN_EXTRA_AUTHORITIES`)——声明即对该域名开放 fence,token 成为剩余唯一控制点 |

"上游机制在该场景下已足够"的适用条件:仅当部署不声明公网 trusted-host、接受远程不可用时,上游 Host fence 独立阻断该攻击面。一旦为远程可用性显式信任公网域名,fence 不再构成屏障,防护依赖 `DSH_LAN_*` 门禁。此时门禁对缺陷本体(入口会话建立)已修复;对机制固有的 token 暴露面——URL 查询参数进入浏览器历史与访问日志、明文链路可嗅探、单一共享 token 无按设备吊销——仍是已知限制,既定缓解是:跨不可信网络的访问以 SSH 隧道或 HTTPS 反向代理包裹、token 取强随机值、轮换 `DSH_LAN_TOKEN` 即吊销(lan-access README 安全警示与 DEPLOY_TUNNEL.md 第 4 节)。

覆盖的后续增量补充:显式启用 `DSH_LAN_TRUST_LOCALHOST`(值 `1`/`true`,默认关闭)时,回环对端且回环 Host 的请求免 token,隧道形态(回环对端 + 公网 Host)与 LAN 形态不在豁免之列;边界与代价见 [lan-access README.zh.md](packages/extensions/lan-access/README.zh.md) 安全警示节。

## 5. 时间线

| 日期(2026) | 事件 | 证据 |
|---|---|---|
| 08-27 13:02 | lan-access 门禁落地,缺陷随实现引入 | `46eaf37299`、`64ae3c1f9f`、`71fbe5bb45` |
| 08-27 13:07 | 验收冒烟:主流程经 `/auth-set` 验证通过;`?token=` 入口的浏览器形态未被覆盖 | `723b224297` |
| 08-27 17:41 | 公网隧道取证:发现并验证登录死循环(302 无 Set-Cookie 的探针记录 + 浏览器记录流落地 401、指引指回自身);同场取证确认 stock 栈经隧道无未鉴权 API 面 | `3a4185a4f9` |
| 08-27 19:26 | 修复并钉死测试链 | `c9cdd50356` |
| 08-27 21:34–21:41 | 修复版进入持续运行的公网隧道部署;验收含"token 入口 → 302 + Set-Cookie → 带 cookie 200" | `6c9c7690ad`、`9bd560f008` |
| 08-27 | 本通告发布 | 本文件 |

## 6. 参考

- 修复 commit:`c9cdd50356`
- 发现与验证取证:[public-tunnel-evidence.zh.md](.agents/notes/implemented/feature/2026-08-27-public-tunnel-evidence.zh.md)
- 门禁机制与安全警示:[lan-access README.zh.md](packages/extensions/lan-access/README.zh.md)
- 部署配方与验收:[DEPLOY_TUNNEL.md](DEPLOY_TUNNEL.md)
