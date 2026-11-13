# hustnet-cloudsafe

华中科技大学校园网（eportal）自动认证，凭据加密存储。基于
[husthelper](https://github.com/aaaa0ggMC/husthelper) 的 `hustnet_minimal.h`
极简 C SDK 实现，零第三方依赖。

## 特性

- **凭据只写不读**：`hustnet-cs set` 用 `systemd-creds` 加密写入
  `/etc/hustnet/hustnet.cred`，不提供读取明文的命令。
  - 有 TPM 时绑定 TPM（`--with-key=auto` 自动选择），换机器无法解密；
  - 无 TPM 时使用 host 密钥，绑定本机 `/var/lib/systemd/credential.secret`
    + machine-id，拷到别处无法解密。
  - 明文仅在 systemd 服务的 `$CREDENTIALS_DIRECTORY`（tmpfs，0400）中存在，
    进程退出即销毁。
- **指定网卡**：`SO_BINDTODEVICE` 绑定出口网卡（安装时 `--iface` 指定，默认 `enp7s0`），
  探测、取公钥、提交认证全部走该网卡。
- **运行时公钥**：登录前请求 `InterFace.do?method=pageInfo` 获取
  `publicKeyModulus/Exponent`，不依赖编译期模数。
- **自动探测**：systemd timer（sysvinit 下为 cron）每 2 分钟探测一次，掉线自动重新认证。
- **双 init 支持**：自动检测 systemd / sysvinit，可用 `--init` 或 `HUSTNET_INIT` 强制指定；
  两种模式下凭据存储方式不同（见下文）。
- **主网卡切换**：认证成功后才把指定网卡提升为默认路由（metric 100），
  失败则回落其他默认路由（如 `enp1s0` metric 1002），避免未认证时断网。

## 安装

```sh
sh install.sh                      # 默认网卡 enp7s0，自动检测 init
sh install.sh --iface eth1         # 指定认证出口网卡
HUSTNET_IFACE=eth1 sh install.sh   # 同上，环境变量方式
sh install.sh --init sysvinit      # 强制 sysvinit 模式（MX Linux / Devuan 等）
HUSTNET_INIT=systemd sh install.sh # 强制 systemd 模式
sh install.sh --uninstall          # 卸载（保留凭据）
```

网卡选择会持久化写入 `/etc/hustnet/env`（`HUSTNET_IFACE=...`），
systemd 服务与 `hustnet-cs status` 都读取该文件，重启后依然生效。
临时覆盖：`HUSTNET_IFACE=eth2 hustnet-cs status`。

安装位置：

| 路径 | 说明 |
| --- | --- |
| `/usr/local/bin/hustnet-cs` | 凭据管理 CLI |
| `/usr/local/libexec/hustnet-auth` | 认证程序（C） |
| `/usr/local/libexec/hustnet-autologin` | 服务入口：认证 + 路由调整 |
| `/etc/hustnet/env` | 持久化的网卡设置 |
| `/etc/hustnet/hustnet.cred` | systemd 模式：systemd-creds 加密凭据（0600） |
| `/etc/hustnet/cred` | sysvinit 模式：明文凭据（0600） |
| `/etc/systemd/system/hustnet-auth.service` | systemd 模式：单次认证 |
| `/etc/systemd/system/hustnet-auth.timer` | systemd 模式：开机后 + 每 2 分钟探测 |
| `/etc/cron.d/hustnet` | sysvinit 模式：每 2 分钟探测（cron） |
| `/var/log/hustnet.log` | sysvinit 模式：认证日志 |
| `/opt/hustnet-cloudsafe/src/` | 源码备份 |

## init 系统

安装脚本自动检测 init（`/run/systemd/system` 存在即视为 systemd），也可以用
`--init auto|systemd|sysvinit` 或 `HUSTNET_INIT` 强制。选择的模式写入
`/etc/hustnet/env`，`hustnet-cs` 和卸载流程都会读取它。

| | systemd 模式 | sysvinit 模式 |
| --- | --- | --- |
| 凭据存储 | `systemd-creds` 加密 → `/etc/hustnet/hustnet.cred` | 默认 `hostkey` → `/etc/hustnet/cred.enc` |
| 凭据注入 | 服务的 `$CREDENTIALS_DIRECTORY`（tmpfs） | `hustnet-run` 解密到 tmpfs |
| 周期性检查 | `hustnet-auth.timer`（每 2 分钟） | `/etc/cron.d/hustnet`（每 2 分钟） |
| 立即认证 | `systemctl start hustnet-auth` | `hustnet-cs login` |
| 日志 | `journalctl -u hustnet-auth` | `tail /var/log/hustnet.log` |
| 依赖 | systemd ≥ 250 | cron + openssl |

## 凭据后端

凭据存储由 `HUSTNET_CRED_BACKEND` 选择，默认 `auto`：

| 后端 | 文件 | 密钥来源 | 特点 |
| --- | --- | --- | --- |
| `systemd-creds` | `/etc/hustnet/hustnet.cred` | TPM 或 systemd host key | 密文，工具不提供回读；需 systemd ≥ 250 |
| `hostkey` | `/etc/hustnet/cred.enc` | 派生自 `/etc/machine-id` | 密文；把磁盘拷到别的机器无法解密；本机 root 仍可解（无 TPM 绑定） |
| `plaintext` | `/etc/hustnet/cred` | 无 | 明文 0600，最弱，仅在 `openssl` 缺失时作为兜底 |

自动选择顺序：`systemd-creds`（systemd + 可用）→ `hostkey`（`openssl` 可用）→ `plaintext`。

```sh
sh install.sh --cred-backend hostkey      # 强制某后端
HUSTNET_CRED_BACKEND=plaintext sh install.sh
```

`hostkey` 模式在每次认证时由 `libexec/hustnet-run` 将凭据解密到
`/dev/shm`（tmpfs），认证结束立即删除；磁盘上只留密文。

源码位于本仓库 `hustnet-cloudsafe/`；其中 `src/hustnet_minimal.h` 是指向仓库根目录
`hustnet_minimal.h`（由 `pnpm net generate_c` 生成）的符号链接，安装时会复制为实体文件。

## 使用

```sh
hustnet-cs set U2025xxxxx      # 交互输入密码（推荐，不进 shell 历史）
hustnet-cs set U2025xxxxx pwd  # 直接传参（会留在历史 / ps，不推荐）
hustnet-cs status              # 探测当前是否已认证
hustnet-cs login               # 立即认证一次
hustnet-cs unset               # 删除凭据
```

查看日志：

```sh
journalctl -u hustnet-auth.service -n 30 --no-pager   # systemd
tail -n 30 /var/log/hustnet.log                       # sysvinit
```

## 退出码（hustnet-auth）

| 码 | 含义 |
| --- | --- |
| 0 | 已在线 / 登录成功 |
| 1 | `--status`：未认证 |
| 2 | 探测无响应 |
| 3 | 门户响应解析失败 |
| 4 | 密码加密失败 |
| 5 | 表单构造失败 |
| 6 | 登录请求无响应 |
| 7 | 门户拒绝登录（密码错误 / 账号异常） |
| 8 | 门户要求图形验证码 |
| 9 | 门户要求短信二次验证 |
| 10 | 未配置凭据 |

## 安全边界（务必了解）

- 明文凭据在认证进程内存中存在一段时间（RSA 加密必须要有明文），
  进程结束前会主动清零缓冲区。
- 本机没有 TPM 时，`root` 理论上可以用 `systemd-creds decrypt` 解出凭据；
  这是无 TPM 环境的固有限制。有 TPM 时可把密钥封进 TPM，root 也无法取出。
- 认证只是把浏览器登录流程自动化，不绕过任何认证。

## 手工排查

```sh
ip -br addr show enp7s0
ip route show default
/usr/local/libexec/hustnet-auth --status --iface enp7s0
systemctl cat hustnet-auth.service      # systemd 模式
cat /etc/cron.d/hustnet                 # sysvinit 模式
hustnet-cs init                         # 当前识别的 init 模式
systemd-creds decrypt --name=hustnet /etc/hustnet/hustnet.cred -   # 需要时才用，会输出明文
```
