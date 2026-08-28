# DEPLOY_TUNNEL.md — dsh web 公网部署配方(named tunnel + NSSM 服务化)

本机实际部署的完整配方。目标形态:`https://dsh.lgyu.cloud`(Cloudflare named tunnel,域名固定)→ cloudflared Windows 服务 → `http://localhost:3080` → dsh web(NSSM 服务 `dsh-web`,开机自启 + 崩溃自愈,token 门禁)。

- 适用:本仓库 fork、Windows、master 分支。
- DSH 源码零改动:token 门禁与信任域全部走既有环境变量机制(`DSH_LAN_TOKEN`、`DSH_LAN_ENABLED`、`DSH_LAN_EXTRA_AUTHORITIES`),不引入任何新代码路径。
- 所有 cloudflared 资产在 `~/.cloudflared`(不进 git);NSSM 可执行文件在仓库 `tools/`(已 gitignore);服务日志在仓库 `.logs/`(已 gitignore)。

## 1. 架构总览

```
浏览器 ──HTTPS──> Cloudflare Edge (dsh.lgyu.cloud, CNAME → tunnel)
                    │
                    ▼ named tunnel 1eebfaa3-c108-4cac-ad1d-67b57aa3aa6a
              cloudflared 服务 (Windows 服务, Automatic)
                    │
                    ▼ http://localhost:3080
              dsh-web 服务 (NSSM, LocalSystem, Automatic)
              LanAccessWebServer: 0.0.0.0:3080, token 门禁
                    │
                    ▼ DSH_HOME=C:\Users\luoguangyu\.dsh
              sessions / settings / credentials
```

分层职责:Cloudflare Edge 提供 TLS 与域名固定;cloudflared 服务提供隧道与断网自动重连;`dsh-web` 服务提供进程常驻;应用层 token 门禁先于 Host 栅栏应答(无凭据返回 401)。

## 2. 前置条件

- 域名 `lgyu.cloud` 已托管到 Cloudflare(免费版即可)。
- Node.js 22.19+ / 24+,仓库已 `pnpm install && pnpm run build`。
- cloudflared ≥ 2024.x(本机为 2026.8.2,winget 安装:`winget install Cloudflare.cloudflared`,可执行文件在 `C:\Program Files (x86)\cloudflared\cloudflared.exe`)。
- NSSM 2.24 已下载解压,`nssm.exe` 放在 `<REPO_DIR>\tools\`(见 3.5 第 1 步)。
- 管理员 PowerShell(3.4、3.5 及全部服务操作需要)。

## 3. 安装步骤

### 3.1 cloudflared 授权

```powershell
cloudflared tunnel login
```

浏览器打开后登录并选择 `lgyu.cloud` zone;成功后凭据写入 `~\.cloudflared\cert.pem`。

### 3.2 创建命名隧道

```powershell
cloudflared tunnel create dsh
```

输出 Tunnel UUID 与凭据文件路径(本机为 `1eebfaa3-c108-4cac-ad1d-67b57aa3aa6a`,`~\.cloudflared\<UUID>.json`)。记录两者,后续两处引用。

### 3.3 配置文件 `~\.cloudflared\config.yml`

```yaml
tunnel: 1eebfaa3-c108-4cac-ad1d-67b57aa3aa6a
credentials-file: C:\Users\luoguangyu\.cloudflared\1eebfaa3-c108-4cac-ad1d-67b57aa3aa6a.json
ingress:
  - hostname: dsh.lgyu.cloud
    service: http://localhost:3080
  - service: http_status:404
```

注意端口是 3080(与 `--port 3080` 一致;不是历史文档中的 3180)。

### 3.4 安装 cloudflared 服务(管理员)

```powershell
cloudflared tunnel route dns dsh dsh.lgyu.cloud   # CNAME 绑定,一次性
cloudflared service install                       # 默认以无参自启
```

关键补充:`service install` 拉起的服务默认不读用户目录的 config,必须把注册表 ImagePath 改写为显式指定配置,再重启服务(直接 Restart 不会应用新 ImagePath 之前,需先停止;若 Stop-Service 卡在 StopPending,用 `taskkill /F /PID <旧进程>` 解锁):

```powershell
Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\cloudflared' -Name ImagePath `
  -Value '"C:\Program Files (x86)\cloudflared\cloudflared.exe" --config "C:\Users\luoguangyu\.cloudflared\config.yml" tunnel run'
Set-Service cloudflared -StartupType Automatic
Restart-Service cloudflared
```

验证:`cloudflared tunnel info dsh` 显示 CONNECTOR 行(4 个 edge 节点)即隧道建立。

### 3.5 dsh web 的 NSSM 服务化(管理员,完整步骤)

第 1 步:准备 NSSM 与日志目录。

```powershell
# 一次性:下载 nssm-2.24.zip(nssm.cc/download),解压取 win64\nssm.exe 放到:
#   <REPO_DIR>\tools\nssm.exe     (仓库自包含,不进 PATH,已 gitignore)
New-Item -ItemType Directory -Force -Path "<REPO_DIR>\.logs" | Out-Null
```

第 2 步:安装服务并写入全部参数。`AppEnvironmentExtra` 是服务运行环境的唯一权威,四个变量缺一不可,另有可选的 `DSH_LAN_TRUST_LOCALHOST`(未设 = 关闭;本机部署不启用)——**漏 `DSH_HOME` 会导致数据根漂移**(见下方说明)。

```powershell
$nssm = "<REPO_DIR>\tools\nssm.exe"
$node = "C:\Program Files\nodejs\node.exe"

& $nssm install dsh-web $node
& $nssm set dsh-web AppParameters "--import tsx/esm apps/cli/src/bin.ts --profile web --port 3080 --no-open"
& $nssm set dsh-web AppDirectory "<REPO_DIR>"
& $nssm set dsh-web AppEnvironmentExtra "DSH_LAN_ENABLED=true" `
    "DSH_LAN_EXTRA_AUTHORITIES=dsh.lgyu.cloud" `
    "DSH_HOME=C:\Users\luoguangyu\.dsh" `
    "DSH_LAN_TOKEN=<TOKEN>"
& $nssm set dsh-web AppStdout  "<REPO_DIR>\.logs\dsh-web-out.log"
& $nssm set dsh-web AppStderr  "<REPO_DIR>\.logs\dsh-web-err.log"
& $nssm set dsh-web AppRotateFiles 1
& $nssm set dsh-web AppRotateOnline 1
& $nssm set dsh-web AppRotateBytes 10485760
& $nssm set dsh-web Start SERVICE_AUTO_START
& $nssm start dsh-web
```

`<TOKEN>` 为强随机值(≥32 字符;生成示例:`[Convert]::ToBase64String((New-Object byte[] 32))`)。token 明文只允许存在于两处:用户级环境变量 `DSH_LAN_TOKEN`(前台手动运行时的来源)与 `HKLM\SYSTEM\CurrentControlSet\Services\dsh-web\Parameters`(服务运行时的权威)。禁止写进本文件、日志或任何 git 内容。

**DSH_HOME 说明(必读):** dsh 的数据根解析为 `DSH_HOME` 环境变量优先、缺省回退 `~/.dsh`(packages/util/home-paths)。NSSM 服务默认以 LocalSystem 运行,其 home 是 `C:\Windows\System32\config\systemprofile`,若不显式指定 `DSH_HOME`,服务会看到空数据根——历史 sessions、settings、`.credentials.yaml`(含 API key)全部"消失"。指定后既有数据完整可见(验收时 `session.list` 返回全部既有记录)。

**DSH_LAN_TRUST_LOCALHOST 说明(可选,本部署不启用):** 该变量启用(值 `1`/`true`)后,本地验收判据随之变化——本机回环自测时,回环对端且回环 Host 的无凭据请求从 401 变为 200 直接放行;公网隧道形态(回环对端 + 公网 Host)与 LAN 形态不受影响,验收第 3 项仍预期 401。启用等于把完整 agent 授权交给本机全部进程,边界与代价见 lan-access README「安全警示」节;`AppEnvironmentExtra` 为整体覆盖语义,若曾启用,任何重设(如 token 轮换)必须一并重写该变量,漏写等于回到关闭。

第 3 步:等待绑定并验证。源码启动(tsx)约需 1 分钟才绑定端口:

```powershell
# 轮询 3080 直到 Listen(Get-NetTCPConnection -LocalPort 3080 -State Listen)
```

## 4. Token 管理

- **权威来源是 NSSM 服务配置**(`dsh-web` 的 `AppEnvironmentExtra`)。用户级环境变量 `DSH_LAN_TOKEN` 仅是前台手动运行时的来源;两者不一致时,服务行为以 NSSM 配置为准。
- token 校验为 SHA-256 摘要 + 常数时间比较;浏览器入口 `https://dsh.lgyu.cloud/?token=<TOKEN>`,302 应答种下 HttpOnly cookie,之后长期免登。
- **轮换流程**(注意 `nssm set AppEnvironmentExtra` 为整体覆盖,必须重设全部四个变量——若启用了可选的 `DSH_LAN_TRUST_LOCALHOST` 须一并重写,漏写等于回到关闭;漏一个 `DSH_HOME` 就触发数据根漂移):

```powershell
# 1. 生成新值
$newToken = [Convert]::ToBase64String((New-Object byte[] 32))   # 自行记录,勿打印到共享日志
# 2. 重写服务环境(管理员;四个条目全量)
& "<REPO_DIR>\tools\nssm.exe" set dsh-web AppEnvironmentExtra `
    "DSH_LAN_ENABLED=true" "DSH_LAN_EXTRA_AUTHORITIES=dsh.lgyu.cloud" `
    "DSH_HOME=C:\Users\luoguangyu\.dsh" "DSH_LAN_TOKEN=$newToken"
# 3. 重启生效
Restart-Service dsh-web
# 4. 浏览器用新 token 重新登录(旧 cookie 失效)
```

建议同步更新用户级环境变量(`[Environment]::SetEnvironmentVariable('DSH_LAN_TOKEN',$newToken,'User')`)保持前台与服务一致。

## 5. 验收清单

全部实测通过(2026-08-27,commit 6c9c7690ad 时点):

| # | 项 | 预期 | 实测 |
|---|---|---|---|
| 1 | `Get-Service dsh-web` | Running | Running / Automatic |
| 2 | `Restart-Service dsh-web`;5s 后再查 | 仍 Running(NSSM 拉起子进程) | Running,3080 由新 PID 重新绑定 |
| 3 | `https://dsh.lgyu.cloud` 无 token | 401 | 401(门禁先于 Host 栅栏) |
| 4 | token 入口后带 cookie `GET /` | 200 | 302 + Set-Cookie → 200(16,885 字节) |
| 5 | `.logs\dsh-web-err.log` | 无致命报错 | 0 字节(另做 token 泄漏扫描:无) |
| 6 | `.gitignore` 覆盖 `tools/`、`.logs/` | 已覆盖 | 已提交(6c9c7690ad) |
| 7 | 强杀 node 子进程后 | NSSM 自动拉起(崩溃自愈) | 旧 PID 7348 被杀 → 服务保持 Running → 新 PID 28748 重新绑定 |
| 8 | `session.list`(带 cookie) | 200 且含既有数据 | 200,70 条既有记录(DSH_HOME 生效) |
| 9 | 重启电脑后 | `dsh-web` 与 `cloudflared` 均自动 Running | 两服务均 Automatic(下次重启自证) |

## 6. 已知权衡

- **服务以 LocalSystem 运行,门禁后的 agent 子进程权限较高**(高于原前台实例的普通用户权限)。当前可接受的依据:Cloudflare Edge + 应用层 token 门禁双层前置,公网面无任何未认证可达路径(无凭据 401);部署目标是个人设备、单用户;token 为 32 字节强随机且只存于本地特权位置。
- 降权路径(Roadmap):为 `dsh-web` 建专用低权限服务账户(`nssm set dsh-web ObjectName <专用账户>`),并把 `DSH_HOME` 数据根的 ACL 收紧到该账户——待出现多用户或长期常驻需求时再做。
- 附带小项:LocalSystem 下 bash 子进程的 HOME 仍是 systemprofile(对 agent 会话内路径解析有极小影响,`DSH_HOME` 已覆盖主要数据面);cloudflared 服务停止偶发 StopPending,需 taskkill 解锁(见 3.4)。

## 7. 日常运维

```powershell
# 状态(管理员)
Get-Service dsh-web, cloudflared
# 重启 dsh web(约 1 分钟后 3080 重新可用)
Restart-Service dsh-web
# 日志(10MB 自动轮转;err 为空是常态)
Get-Content "<REPO_DIR>\.logs\dsh-web-err.log" -Tail 20
Get-Content "<REPO_DIR>\.logs\dsh-web-out.log" -Tail 10
# 隧道连接状态
cloudflared tunnel info dsh
# 卸载(如需)
& "<REPO_DIR>\tools\nssm.exe" remove dsh-web confirm   # 管理员
```

改动配置(如换端口、换域名)的生效方式:改 `~\.cloudflared\config.yml` 后 `Restart-Service cloudflared`;改 NSSM 参数后 `Restart-Service dsh-web`。
