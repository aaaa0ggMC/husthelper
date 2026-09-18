#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${HUSTNET_INSTALL_DIR:-$HOME/.local/bin}"
TARGET_BIN="${INSTALL_DIR}/hustnet"

echo "==> 正在卸载 hustnet CLI ..."

if [ -f "${TARGET_BIN}" ]; then
  rm -f "${TARGET_BIN}"
  echo "==> 已成功移除: ${TARGET_BIN}"
else
  echo "提示: 未在 ${INSTALL_DIR} 找到 hustnet 可执行文件，可能尚未安装或已被清理。"
fi

echo "卸载完成。"
