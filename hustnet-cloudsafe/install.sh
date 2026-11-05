#!/bin/sh
#
# hustnet-cloudsafe 安装脚本
#
#   sh install.sh          安装 / 升级
#
# 需要 root。会：
#   * 编译 hustnet-auth 到 /usr/local/libexec/
#   * 安装 hustnet-cs 到 /usr/local/bin/
#   * 安装 systemd 单元并启用定时探测
#   * 把 enp7s0 写入 /etc/network/interfaces（开机 DHCP）
#   * 在 /etc/dhcpcd.conf 里把 enp7s0 的默认路由 metric 设为 2100（备用），
#     认证成功后再由 hustnet-autologin 提升到 100

set -eu

BASE=$(cd "$(dirname "$0")" && pwd)
PREFIX=/usr/local
LIBEXEC=$PREFIX/libexec
CRED_DIR=/etc/hustnet
IFACE=${HUSTNET_IFACE:-enp7s0}

if [ "$(id -u)" -ne 0 ]; then
    echo "error: root privileges required" >&2
    exit 1
fi

echo "== building hustnet-auth =="
gcc -O2 -Wall -Wextra -o "$BASE/hustnet-auth" "$BASE/src/hustnet-auth.c"

echo "== installing binaries =="
install -d -m 755 "$LIBEXEC"
install -d -m 755 /opt/hustnet-cloudsafe/src
install -d -m 700 "$CRED_DIR"
install -m 755 "$BASE/hustnet-auth" "$LIBEXEC/hustnet-auth"
install -m 755 "$BASE/bin/hustnet-cs" "$PREFIX/bin/hustnet-cs"
install -m 755 "$BASE/libexec/hustnet-autologin" "$LIBEXEC/hustnet-autologin"
install -m 644 "$BASE/src/hustnet-auth.c" /opt/hustnet-cloudsafe/src/hustnet-auth.c
install -m 644 "$BASE/src/hustnet_minimal.h" /opt/hustnet-cloudsafe/src/hustnet_minimal.h
install -m 644 "$BASE/README.md" /opt/hustnet-cloudsafe/README.md

echo "== installing systemd units =="
install -m 644 "$BASE/systemd/hustnet-auth.service" /etc/systemd/system/hustnet-auth.service
install -m 644 "$BASE/systemd/hustnet-auth.timer" /etc/systemd/system/hustnet-auth.timer
systemctl daemon-reload

echo "== configuring boot DHCP for $IFACE =="
if ! grep -q "^auto $IFACE" /etc/network/interfaces 2>/dev/null; then
    printf '\nauto %s\niface %s inet dhcp\n' "$IFACE" "$IFACE" >> /etc/network/interfaces
    echo "appended auto $IFACE to /etc/network/interfaces"
fi

echo "== configuring dhcpcd metric ($IFACE stays 2100 until auth succeeds) =="
if [ ! -f /etc/dhcpcd.conf ]; then
    : > /etc/dhcpcd.conf
fi
if ! grep -q "^[[:space:]]*interface $IFACE[[:space:]]*$" /etc/dhcpcd.conf; then
    printf '\ninterface %s\n    metric 2100\n' "$IFACE" >> /etc/dhcpcd.conf
    echo "appended interface $IFACE / metric 2100 to /etc/dhcpcd.conf"
else
    echo "/etc/dhcpcd.conf already has $IFACE config, left unchanged"
fi

echo "== applying DHCP config (restart dhcpcd on $IFACE) =="
ifdown "$IFACE" 2>/dev/null || true
ifup "$IFACE" 2>/dev/null || true

echo "== enabling periodic check =="
systemctl enable --now hustnet-auth.timer >/dev/null 2>&1 || true
systemctl enable hustnet-auth.service >/dev/null 2>&1 || true

echo
echo "Installation complete. Next steps:"
echo "  hustnet-cs set <username>    # prompts for password, encrypted by systemd-creds"
echo "  hustnet-cs status            # check whether $IFACE is authenticated"
echo "  systemctl start hustnet-auth # authenticate once now"
