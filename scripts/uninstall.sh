#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${HUSTNET_INSTALL_DIR:-$HOME/.local/bin}"
TARGET_BIN="${INSTALL_DIR}/hustnet"

echo "==> 正在卸载 hustnet CLI ..."

if [ -f "${TARGET_BIN}" ]; then
  # 只删除本工具生成的 wrapper（含 net_cli.ts 标记），避免误删同名无关文件
  if grep -q "examples/net_cli.ts" "${TARGET_BIN}" 2>/dev/null; then
    rm -f -- "${TARGET_BIN}"
    echo "==> 已成功移除: ${TARGET_BIN}"
  else
    echo "拒绝删除: ${TARGET_BIN} 不是本工具生成的 wrapper（未找到 net_cli.ts 标记）。" >&2
    echo "如确认要删除，请手动执行: rm -f -- '${TARGET_BIN}'" >&2
    exit 1
  fi
else
  echo "提示: 未在 ${INSTALL_DIR} 找到 hustnet 可执行文件，可能尚未安装或已被清理。"
fi

echo "卸载完成。"
