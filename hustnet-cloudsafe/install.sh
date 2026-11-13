#!/bin/sh
#
# hustnet-cloudsafe installer
#
#   sudo sh install.sh [--iface <dev>] [--init auto|systemd|sysvinit]
#   sudo sh install.sh --uninstall
#
# Installs:
#   * /usr/local/libexec/hustnet-auth       compiled C authenticator
#   * /usr/local/libexec/hustnet-autologin  service entry: auth + route switch
#   * /usr/local/bin/hustnet-cs             credential manager
#   * /etc/hustnet/env                      persistent HUSTNET_IFACE setting
#   * /etc/hustnet/                         credential dir (0700)
#   * periodic check, depending on the init system:
#       systemd  -> hustnet-auth.service + .timer (boot + every 2 minutes)
#       sysvinit -> /etc/cron.d/hustnet         (every 2 minutes)
#   * /etc/network/interfaces entry         boot DHCP for the uplink
#   * /etc/dhcpcd.conf metric 2100          keep uplink as backup until auth ok
#
# The uplink interface can be chosen three ways (highest priority first):
#   sh install.sh --iface eth1
#   HUSTNET_IFACE=eth1 sh install.sh
#   (default) enp7s0
#
# The init system is detected automatically. Force it with --init or
# HUSTNET_INIT=systemd|sysvinit when detection is unreliable (e.g. inside
# a container). Credential storage differs per mode:
#   systemd  -> systemd-creds encrypted file, decrypted into the service's
#               $CREDENTIALS_DIRECTORY
#   sysvinit -> plaintext file /etc/hustnet/cred (0600), passed via --cred
#
# Requirements: root, Linux, a C compiler. systemd >= 250 (systemd-creds)
# is only required in systemd mode. On Debian/Ubuntu a missing gcc is
# installed automatically.

set -eu

VERSION=1.1.0
BASE=$(cd "$(dirname "$0")" && pwd)
PREFIX=/usr/local
LIBEXEC=$PREFIX/libexec
CRED_DIR=/etc/hustnet
ENV_FILE=$CRED_DIR/env
CRON_FILE=/etc/cron.d/hustnet
IFACE=""
INIT=""
CRED_BACKEND=""

usage() {
    cat <<EOF
hustnet-cloudsafe $VERSION installer

Usage:
  sudo sh install.sh [--iface <dev>] [--init auto|systemd|sysvinit] [--cred-backend auto|systemd-creds|hostkey|plaintext]
  sudo sh install.sh --uninstall

Options:
  --iface <dev>   uplink interface to authenticate on (default: enp7s0)
  --init <mode>   init system: auto (default), systemd or sysvinit
  --cred-backend  credential storage: auto (default), systemd-creds,
                  hostkey or plaintext (see README)
  --uninstall     stop services and remove installed files
  -h, --help      show this help

Environment:
  HUSTNET_IFACE         same as --iface, used when the flag is absent
  HUSTNET_INIT          same as --init, used when the flag is absent
  HUSTNET_CRED_BACKEND  same as --cred-backend
EOF
}

have() { command -v "$1" >/dev/null 2>&1; }

detect_init() {
    case "${HUSTNET_INIT:-auto}" in
        systemd|sysvinit)
            echo "$HUSTNET_INIT"
            ;;
        *)
            if [ -d /run/systemd/system ]; then
                echo systemd
            else
                echo sysvinit
            fi
            ;;
    esac
}

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
        --init)
            [ "$#" -ge 2 ] || { echo "error: --init needs a value" >&2; exit 1; }
            INIT=$2
            shift 2
            ;;
        --init=*)
            INIT=${1#*=}
            shift
            ;;
        --cred-backend)
            [ "$#" -ge 2 ] || { echo "error: --cred-backend needs a value" >&2; exit 1; }
            CRED_BACKEND=$2
            shift 2
            ;;
        --cred-backend=*)
            CRED_BACKEND=${1#*=}
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

INIT=${INIT:-${HUSTNET_INIT:-auto}}
case "$INIT" in
    auto) INIT=$(detect_init) ;;
esac
case "$INIT" in
    systemd|sysvinit) ;;
    *)
        echo "error: unsupported init mode: $INIT (use auto, systemd or sysvinit)" >&2
        exit 1
        ;;
esac

# Credential backend defaults:
#   systemd  -> systemd-creds (needs systemd >= 250)
#   sysvinit -> hostkey (needs openssl), plaintext as last resort
CRED_BACKEND=${CRED_BACKEND:-${HUSTNET_CRED_BACKEND:-auto}}
case "$CRED_BACKEND" in
    auto)
        if [ "$INIT" = systemd ] && have systemd-creds; then
            CRED_BACKEND=systemd-creds
        elif have openssl; then
            CRED_BACKEND=hostkey
        else
            CRED_BACKEND=plaintext
        fi
        ;;
    systemd-creds)
        if [ "$INIT" != systemd ]; then
            echo "error: --cred-backend systemd-creds requires --init systemd" >&2
            exit 1
        fi
        ;;
    hostkey|plaintext) ;;
    *)
        echo "error: unsupported credential backend: $CRED_BACKEND" >&2
        echo "       (use auto, systemd-creds, hostkey or plaintext)" >&2
        exit 1
        ;;
esac

IFACE=${IFACE:-${HUSTNET_IFACE:-enp7s0}}

if [ "$(id -u)" -ne 0 ]; then
    echo "error: root privileges required" >&2
    exit 1
fi

# ---------------------------------------------------------------- uninstall
if [ "$UNINSTALL" -eq 1 ]; then
    # Prefer the mode recorded at install time over auto-detection.
    if [ -r "$ENV_FILE" ]; then
        _saved_init=$(sed -n 's/^HUSTNET_INIT=//p' "$ENV_FILE" 2>/dev/null || true)
        case "$_saved_init" in
            systemd|sysvinit) INIT=$_saved_init ;;
        esac
    fi
    if [ "$INIT" = systemd ]; then
        echo "== stopping services =="
        systemctl disable --now hustnet-auth.timer >/dev/null 2>&1 || true
        systemctl disable hustnet-auth.service >/dev/null 2>&1 || true
        systemctl stop hustnet-auth.service >/dev/null 2>&1 || true
    fi

    echo "== removing files =="
    rm -f /etc/systemd/system/hustnet-auth.service \
          /etc/systemd/system/hustnet-auth.timer \
          "$CRON_FILE" \
          "$LIBEXEC/hustnet-auth" \
          "$LIBEXEC/hustnet-autologin" \
          "$PREFIX/bin/hustnet-cs"
    rm -rf /opt/hustnet-cloudsafe
    if [ "$INIT" = systemd ]; then
        systemctl daemon-reload
    fi

    echo "Removed. Credentials in $CRED_DIR were kept; delete manually if unwanted:"
    echo "  rm -rf $CRED_DIR"
    exit 0
fi

echo "hustnet-cloudsafe $VERSION"
echo "uplink interface: $IFACE"
echo "init system: $INIT"

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
if [ "$INIT" = systemd ] && [ "$CRED_BACKEND" = systemd-creds ]; then
    if ! have systemd-creds; then
        echo "error: systemd-creds not found (systemd >= 250 required)" >&2
        echo "hint: on a sysvinit system run: sh install.sh --init sysvinit" >&2
        exit 1
    fi
fi
if [ "$CRED_BACKEND" = hostkey ] && ! have openssl; then
    echo "error: hostkey backend needs openssl; install it or use --cred-backend plaintext" >&2
    exit 1
fi
if [ "$INIT" = sysvinit ] && ! have crontab; then
    echo "warning: crontab not found; install cron or run the authenticator manually" >&2
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
install -m 755 "$BASE/libexec/hustnet-run" "$LIBEXEC/hustnet-run"
install -m 644 "$BASE/src/hustnet-auth.c" /opt/hustnet-cloudsafe/src/hustnet-auth.c
install -m 644 "$BASE/src/hustnet_minimal.h" /opt/hustnet-cloudsafe/src/hustnet_minimal.h
install -m 644 "$BASE/README.md" /opt/hustnet-cloudsafe/README.md
install -m 644 "$BASE/VERSION" /opt/hustnet-cloudsafe/VERSION

echo "== saving uplink interface to $ENV_FILE =="
printf 'HUSTNET_IFACE=%s\nHUSTNET_INIT=%s\nHUSTNET_CRED_BACKEND=%s\n' \
    "$IFACE" "$INIT" "$CRED_BACKEND" > "$ENV_FILE"
chmod 644 "$ENV_FILE"

rm -f "$BASE/hustnet-auth"

if [ "$INIT" = systemd ]; then
    echo "== installing systemd units =="
    install -m 644 "$BASE/systemd/hustnet-auth.service" /etc/systemd/system/hustnet-auth.service
    install -m 644 "$BASE/systemd/hustnet-auth.timer" /etc/systemd/system/hustnet-auth.timer
    systemctl daemon-reload
else
    echo "== installing cron job ($CRON_FILE) =="
    if [ "$CRED_BACKEND" = hostkey ]; then
        CRON_CMD="$LIBEXEC/hustnet-run --quiet"
        CRON_DESC="host-key encrypted credential: $CRED_DIR/cred.enc"
    else
        CRON_CMD="$LIBEXEC/hustnet-auth --iface $IFACE --cred $CRED_DIR/cred --quiet"
        CRON_DESC="plaintext credential: $CRED_DIR/cred (0600)"
    fi
    cat > "$CRON_FILE" <<EOF
# hustnet-cloudsafe: periodic campus network authentication (sysvinit mode)
# $CRON_DESC
*/2 * * * * root $CRON_CMD >>/var/log/hustnet.log 2>&1
EOF
    chmod 644 "$CRON_FILE"
    touch /var/log/hustnet.log
    chmod 640 /var/log/hustnet.log
fi

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
if [ "$INIT" = systemd ]; then
    systemctl enable --now hustnet-auth.timer >/dev/null 2>&1 || true
    systemctl enable hustnet-auth.service >/dev/null 2>&1 || true
else
    service cron restart >/dev/null 2>&1 || service cron start >/dev/null 2>&1 || true
    if ! service cron status >/dev/null 2>&1; then
        echo "warning: cron is not running; enable it so the 2-minute check can fire"
    fi
fi

echo
echo "Installation complete (version $VERSION, uplink $IFACE, init $INIT). Next steps:"
if [ "$INIT" = systemd ]; then
    echo "  hustnet-cs set <username>    # prompts for password, encrypted by systemd-creds"
    echo "  hustnet-cs status            # check whether $IFACE is authenticated"
    echo "  systemctl start hustnet-auth # authenticate once now"
    echo "  journalctl -u hustnet-auth.service -n 30 --no-pager"
else
    if [ "$CRED_BACKEND" = hostkey ]; then
        echo "  hustnet-cs set <username>    # prompts for password; host-key encrypted (copy-safe)"
    else
        echo "  hustnet-cs set <username>    # prompts for password; plaintext $CRED_DIR/cred (0600)"
    fi
    echo "  hustnet-cs status            # check whether $IFACE is authenticated"
    echo "  hustnet-cs login             # authenticate once now"
    echo "  tail -n 30 /var/log/hustnet.log"
fi
