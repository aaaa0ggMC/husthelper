#!/bin/sh
#
# hustnet-cloudsafe installer
#
#   sudo sh install.sh [--iface <dev>]
#   sudo sh install.sh --uninstall
#
# Installs:
#   * /usr/local/libexec/hustnet-auth       compiled C authenticator
#   * /usr/local/libexec/hustnet-autologin  service entry: auth + route switch
#   * /usr/local/bin/hustnet-cs             encrypted credential manager
#   * /etc/hustnet/env                      persistent HUSTNET_IFACE setting
#   * /etc/hustnet/                         credential dir (systemd-creds, 0700)
#   * systemd units + timer                 boot check and every 2 minutes
#   * /etc/network/interfaces entry         boot DHCP for the uplink
#   * /etc/dhcpcd.conf metric 2100          keep uplink as backup until auth ok
#
# The uplink interface can be chosen three ways (highest priority first):
#   sh install.sh --iface eth1
#   HUSTNET_IFACE=eth1 sh install.sh
#   (default) enp7s0
#
# Requirements: root, Linux + systemd (>= 250 for systemd-creds), gcc.
# On Debian/Ubuntu a missing gcc is installed automatically.

set -eu

VERSION=1.1.0
BASE=$(cd "$(dirname "$0")" && pwd)
PREFIX=/usr/local
LIBEXEC=$PREFIX/libexec
CRED_DIR=/etc/hustnet
ENV_FILE=$CRED_DIR/env
IFACE=""

usage() {
    cat <<EOF
hustnet-cloudsafe $VERSION installer

Usage:
  sudo sh install.sh [--iface <dev>]
  sudo sh install.sh --uninstall

Options:
  --iface <dev>   uplink interface to authenticate on (default: enp7s0)
  --uninstall     stop services and remove installed files
  -h, --help      show this help

Environment:
  HUSTNET_IFACE   same as --iface, used when the flag is absent
EOF
}

have() { command -v "$1" >/dev/null 2>&1; }

UNINSTALL=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        --iface)
            [ "$#" -ge 2 ] || { echo "error: --iface needs a value" >&2; exit 1; }
            IFACE=$2
            shift 2
            ;;
        --iface=*)
            IFACE=${1#*=}
            shift
            ;;
        --uninstall)
            UNINSTALL=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "error: unknown argument: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

IFACE=${IFACE:-${HUSTNET_IFACE:-enp7s0}}

if [ "$(id -u)" -ne 0 ]; then
    echo "error: root privileges required" >&2
    exit 1
fi

# ---------------------------------------------------------------- uninstall
if [ "$UNINSTALL" -eq 1 ]; then
    echo "== stopping services =="
    systemctl disable --now hustnet-auth.timer >/dev/null 2>&1 || true
    systemctl disable hustnet-auth.service >/dev/null 2>&1 || true
    systemctl stop hustnet-auth.service >/dev/null 2>&1 || true

    echo "== removing files =="
    rm -f /etc/systemd/system/hustnet-auth.service \
          /etc/systemd/system/hustnet-auth.timer \
          "$LIBEXEC/hustnet-auth" \
          "$LIBEXEC/hustnet-autologin" \
          "$PREFIX/bin/hustnet-cs"
    rm -rf /opt/hustnet-cloudsafe
    systemctl daemon-reload

    echo "Removed. Credentials in $CRED_DIR were kept; delete manually if unwanted:"
    echo "  rm -rf $CRED_DIR"
    exit 0
fi

echo "hustnet-cloudsafe $VERSION"
echo "uplink interface: $IFACE"

# ------------------------------------------------------------- dependencies
if ! have gcc; then
    if have apt-get; then
        echo "== installing build dependencies =="
        DEBIAN_FRONTEND=noninteractive apt-get update -qq
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gcc libc6-dev
    else
        echo "error: gcc not found; install a C compiler first" >&2
        exit 1
    fi
fi
if ! have systemd-creds; then
    echo "error: systemd-creds not found (systemd >= 250 required)" >&2
    exit 1
fi

# ------------------------------------------------------------------ build
echo "== building hustnet-auth =="
gcc -O2 -Wall -Wextra -o "$BASE/hustnet-auth" "$BASE/src/hustnet-auth.c"
"$BASE/hustnet-auth" --help >/dev/null

# ---------------------------------------------------------------- install
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
install -m 644 "$BASE/VERSION" /opt/hustnet-cloudsafe/VERSION

echo "== saving uplink interface to $ENV_FILE =="
printf 'HUSTNET_IFACE=%s\n' "$IFACE" > "$ENV_FILE"
chmod 644 "$ENV_FILE"

rm -f "$BASE/hustnet-auth"

echo "== installing systemd units =="
install -m 644 "$BASE/systemd/hustnet-auth.service" /etc/systemd/system/hustnet-auth.service
install -m 644 "$BASE/systemd/hustnet-auth.timer" /etc/systemd/system/hustnet-auth.timer
systemctl daemon-reload

# ------------------------------------------------------- boot DHCP (ifupdown)
if have ifup && [ -f /etc/network/interfaces ]; then
    echo "== configuring boot DHCP for $IFACE =="
    if ! grep -q "^auto $IFACE" /etc/network/interfaces 2>/dev/null; then
        printf '\nauto %s\niface %s inet dhcp\n' "$IFACE" "$IFACE" >> /etc/network/interfaces
        echo "appended auto $IFACE to /etc/network/interfaces"
    else
        echo "$IFACE already present in /etc/network/interfaces"
    fi
else
    echo "warning: ifupdown not found; configure DHCP for $IFACE manually"
fi

# ------------------------------------------------- dhcpcd metric for uplink
if have dhcpcd; then
    echo "== configuring dhcpcd metric ($IFACE stays 2100 until auth succeeds) =="
    [ -f /etc/dhcpcd.conf ] || : > /etc/dhcpcd.conf
    if ! grep -q "^[[:space:]]*interface $IFACE[[:space:]]*$" /etc/dhcpcd.conf; then
        printf '\ninterface %s\n    metric 2100\n' "$IFACE" >> /etc/dhcpcd.conf
        echo "appended interface $IFACE / metric 2100 to /etc/dhcpcd.conf"
    else
        echo "/etc/dhcpcd.conf already has $IFACE config, left unchanged"
    fi
else
    echo "warning: dhcpcd not found; skip metric config"
fi

# ------------------------------------------------------------------ restart
echo "== applying network config =="
if have ifdown && have ifup; then
    ifdown "$IFACE" 2>/dev/null || true
    ifup "$IFACE" 2>/dev/null || true
fi

echo "== enabling periodic check =="
systemctl enable --now hustnet-auth.timer >/dev/null 2>&1 || true
systemctl enable hustnet-auth.service >/dev/null 2>&1 || true

echo
echo "Installation complete (version $VERSION, uplink $IFACE). Next steps:"
echo "  hustnet-cs set <username>    # prompts for password, encrypted by systemd-creds"
echo "  hustnet-cs status            # check whether $IFACE is authenticated"
echo "  systemctl start hustnet-auth # authenticate once now"
echo "  journalctl -u hustnet-auth.service -n 30 --no-pager"
