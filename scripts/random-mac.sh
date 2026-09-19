#!/usr/bin/env bash
#
# 随机 MAC 开关（NetworkManager / nmcli）
#
# 用于触发/复现 CAS 的「终端疑似发生变化」风控（随机 MAC 会被视为新设备），
# 也可单纯用于隐私。Wi-Fi 仅作用于指定 SSID 的 profile（默认锁定 HUST_WIRELESS），
# 不会误改其他已保存的 Wi-Fi。
#
# 用法:
#   scripts/random-mac.sh on  [wifi|ethernet|all]   开启随机 MAC（默认 all）
#   scripts/random-mac.sh off [wifi|ethernet|all]   关闭并恢复硬件永久 MAC
#   scripts/random-mac.sh status                    查看当前配置与接口 MAC
#   scripts/random-mac.sh apply                     重新激活「已连接」的 profile 使改动生效
#
# 环境变量:
#   HUST_WIFI_SSID  锁定的 Wi-Fi SSID，默认 HUST_WIRELESS
#   MAC_MODE        随机模式，默认 random
#                   random（每次连接都换）| stable | stable-ssid | <MAC 地址>
#
# 依赖: NetworkManager (nmcli)；写操作需要 root / sudo。

set -euo pipefail

WIFI_SSID="${HUST_WIFI_SSID:-HUST_WIRELESS}"
MAC_MODE="${MAC_MODE:-random}"

info() { printf '%s\n' "$*"; }
warn() { printf '警告: %s\n' "$*" >&2; }
die() {
  printf '错误: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
随机 MAC 开关（NetworkManager / nmcli）

用法:
  scripts/random-mac.sh on  [wifi|ethernet|all]   开启随机 MAC（默认 all）
  scripts/random-mac.sh off [wifi|ethernet|all]   关闭并恢复硬件永久 MAC
  scripts/random-mac.sh status                    查看当前配置与接口 MAC
  scripts/random-mac.sh apply                     重新激活「已连接」的 profile 使改动生效

环境变量:
  HUST_WIFI_SSID  锁定的 Wi-Fi SSID，默认 HUST_WIRELESS
  MAC_MODE        随机模式，默认 random
                  random（每次连接都换）| stable | stable-ssid | <MAC 地址>

示例:
  sudo HUST_WIFI_SSID=HUST_WIRELESS scripts/random-mac.sh on
  scripts/random-mac.sh on wifi
  MAC_MODE=stable-ssid scripts/random-mac.sh on
  scripts/random-mac.sh off all
  scripts/random-mac.sh status
EOF
}

require_nmcli() {
  command -v nmcli >/dev/null 2>&1 || die "未找到 nmcli（本脚本依赖 NetworkManager）"
}

# 写操作：非 root 时走 sudo
run_nm() {
  if [[ "${EUID}" -eq 0 ]]; then
    nmcli "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo nmcli "$@"
  else
    die "修改 NetworkManager 配置需要 root 权限（且未找到 sudo）"
  fi
}

# `-t` 模式下每行形如 NAME:TYPE（名称里的冒号会被转义成 \:）
name_of() { printf '%s' "${1%:*}"; }
type_of() { printf '%s' "${1##*:}"; }

list_active() { nmcli -t -f NAME connection show --active; }

is_active() {
  local target="$1" line
  while IFS= read -r line; do
    [[ "$line" == "$target" ]] && return 0
  done < <(list_active)
  return 1
}

# 读取 setting 子键（`nmcli -g` 不支持子键，只能从全量输出里取）
get_setting() {
  local conn="$1" key="$2"
  nmcli connection show "$conn" 2>/dev/null |
    awk -v k="${key}:" 'index($0, k) == 1 { sub(/^[^:]*:[[:space:]]*/, ""); print; exit }'
}

# 空 / `--` 表示未显式设置，等价于使用硬件永久 MAC
display_mac() {
  local value="$1"
  if [[ -z "$value" || "$value" == "--" ]]; then
    printf 'permanent (硬件默认)'
  else
    printf '%s' "$value"
  fi
}

list_wifi_conns() {
  local line name ssid
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    name="$(name_of "$line")"
    [[ "$(type_of "$line")" == "802-11-wireless" ]] || continue
    ssid="$(get_setting "$name" "802-11-wireless.ssid")"
    [[ "$ssid" == "$WIFI_SSID" ]] && printf '%s\n' "$name"
  done < <(nmcli -t -f NAME,TYPE connection show)
}

list_ethernet_conns() {
  local line
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    [[ "$(type_of "$line")" == "802-3-ethernet" ]] && printf '%s\n' "$(name_of "$line")"
  done < <(nmcli -t -f NAME,TYPE connection show)
}

# on|off -> cloned-mac-address 取值
mode_value() {
  local want="$1"
  if [[ "$want" == "off" ]]; then
    printf 'permanent'
    return 0
  fi
  case "$MAC_MODE" in
    permanent | random | stable | stable-ssid)
      printf '%s' "$MAC_MODE"
      ;;
    *)
      if [[ "$MAC_MODE" =~ ^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$ ]]; then
        printf '%s' "$MAC_MODE"
      else
        die "无效的 MAC_MODE='$MAC_MODE'（应为 permanent/random/stable/stable-ssid 或 MAC 地址）"
      fi
      ;;
  esac
}

# 已连接的 profile 重新激活才会立刻换 MAC（会短暂断网）；未连接的下次连接自然生效
apply_conn() {
  local conn="$1"
  if is_active "$conn"; then
    if run_nm connection up "$conn" >/dev/null 2>&1; then
      info "  ↳ 已重新激活 [$conn] 使改动生效"
    else
      warn "  ↳ 重新激活 [$conn] 失败，可稍后手动执行: nmcli connection up '$conn'"
    fi
  else
    info "  ↳ [$conn] 当前未连接，改动将在下次连接时生效"
  fi
}

set_one() {
  local kind="$1" conn="$2" value="$3" key label
  if [[ "$kind" == "wifi" ]]; then
    key="wifi.cloned-mac-address"
    label="Wi-Fi "
  else
    key="ethernet.cloned-mac-address"
    label="以太网"
  fi
  run_nm connection modify "$conn" "$key" "$value"
  info "$label [$conn] cloned-mac-address = $value"
  apply_conn "$conn"
}

set_wifi() {
  local value conn found=0
  value="$(mode_value "$1")"
  while IFS= read -r conn; do
    [[ -z "$conn" ]] && continue
    found=1
    set_one wifi "$conn" "$value"
  done < <(list_wifi_conns)
  ((found)) || die "未找到 SSID='$WIFI_SSID' 的 Wi-Fi 连接（可用 HUST_WIFI_SSID 覆盖）"
}

set_ethernet() {
  local value conn found=0
  value="$(mode_value "$1")"
  while IFS= read -r conn; do
    [[ -z "$conn" ]] && continue
    found=1
    set_one ethernet "$conn" "$value"
  done < <(list_ethernet_conns)
  ((found)) || die "未找到有线（802-3-ethernet）连接"
}

do_set() {
  local want="$1" target="${2:-all}"
  case "$target" in
    wifi) set_wifi "$want" ;;
    ethernet | wired | eth) set_ethernet "$want" ;;
    all | "") set_wifi "$want"; set_ethernet "$want" ;;
    *) die "未知目标 '$target'（应为 wifi|ethernet|all）" ;;
  esac
}

show_status() {
  info "锁定 Wi-Fi SSID: $WIFI_SSID    MAC_MODE: $MAC_MODE"
  local conn found=0 value
  while IFS= read -r conn; do
    [[ -z "$conn" ]] && continue
    found=1
    value="$(get_setting "$conn" "802-11-wireless.cloned-mac-address")"
    printf '  Wi-Fi  [%s] cloned-mac-address = %s\n' "$conn" "$(display_mac "$value")"
  done < <(list_wifi_conns)
  ((found)) || warn "  未找到 SSID='$WIFI_SSID' 的 Wi-Fi 连接"

  while IFS= read -r conn; do
    [[ -z "$conn" ]] && continue
    value="$(get_setting "$conn" "802-3-ethernet.cloned-mac-address")"
    printf '  以太网 [%s] cloned-mac-address = %s\n' "$conn" "$(display_mac "$value")"
  done < <(list_ethernet_conns)

  info ""
  info "接口当前 MAC:"
  ip -o link show 2>/dev/null | awk '
    {
      iface = $2; sub(/:$/, "", iface);
      mac = "";
      for (i = 1; i <= NF; i++) if ($i == "link/ether") mac = $(i + 1);
      if (mac != "") printf "  %-14s %s\n", iface, mac;
    }'
}

do_apply() {
  local conn
  while IFS= read -r conn; do
    if [[ -n "$conn" ]] && is_active "$conn"; then apply_conn "$conn"; fi
  done < <(list_wifi_conns)
  while IFS= read -r conn; do
    if [[ -n "$conn" ]] && is_active "$conn"; then apply_conn "$conn"; fi
  done < <(list_ethernet_conns)
}

main() {
  require_nmcli
  local cmd="${1:-}"
  case "$cmd" in
    on) do_set on "${2:-all}" ;;
    off) do_set off "${2:-all}" ;;
    status) show_status ;;
    apply) do_apply ;;
    -h | --help | help | "") usage ;;
    *) die "未知命令 '$cmd'（见 --help）" ;;
  esac
}

main "$@"
