#!/usr/bin/env bash
set -euo pipefail

# 脚本所在仓库根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# 安装目标目录，默认 ~/.local/bin
INSTALL_DIR="${HUSTNET_INSTALL_DIR:-$HOME/.local/bin}"
TARGET_BIN="${INSTALL_DIR}/hustnet"

echo "==> 正在安装 hustnet CLI 到 ${INSTALL_DIR} ..."

mkdir -p "${INSTALL_DIR}"

# 检查 Node.js 环境
if ! command -v node >/dev/null 2>&1; then
  echo "警告: 未检测到 node 命令。请确保已安装 Node.js 22+ 并加入 PATH。"
else
  NODE_MAJOR=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo "0")
  if [ "${NODE_MAJOR}" -lt 22 ]; then
    echo "警告: 检测到 Node.js 版本低于 22 (当前: $(node -v))，建议升级到 Node.js 22+。"
  fi
fi

# 覆盖前：若目标已存在且非本工具生成，先备份，避免误覆盖
if [ -e "${TARGET_BIN}" ] && ! grep -q "hustnet/bin/hustnet.ts" "${TARGET_BIN}" 2>/dev/null; then
  BACKUP="${TARGET_BIN}.bak.$(date +%s)"
  cp -p -- "${TARGET_BIN}" "${BACKUP}"
  echo "注意: ${TARGET_BIN} 已存在且非本工具生成，已备份到 ${BACKUP}"
fi

# 先移除旧文件（含符号链接，避免 cat 跟随链接覆盖到别处），再写入
rm -f -- "${TARGET_BIN}"

# 生成可执行包装脚本
cat <<EOF > "${TARGET_BIN}"
#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR}"
ENTRY="\${REPO_DIR}/hustnet/bin/hustnet.ts"

CONFIG_ARGS=()
HAS_CONFIG=0

# 检查用户命令行是否显式传入了 --config 或 -c
for arg in "\$@"; do
  if [[ "\${arg}" == "-c" || "\${arg}" == "--config" || "\${arg}" == --config=* || "\${arg}" == -c=* ]]; then
    HAS_CONFIG=1
    break
  fi
done

# 若未显式指定，且当前目录不存在 hustnet.json，则尝试查找默认配置
if [ "\${HAS_CONFIG}" -eq 0 ] && [ ! -f "hustnet.json" ]; then
  if [ -f "\$HOME/.config/hustnet/hustnet.json" ]; then
    CONFIG_ARGS=("--config" "\$HOME/.config/hustnet/hustnet.json")
  elif [ -f "\${REPO_DIR}/hustnet.json" ]; then
    CONFIG_ARGS=("--config" "\${REPO_DIR}/hustnet.json")
  fi
fi

exec node --experimental-strip-types "\${ENTRY}" "\${CONFIG_ARGS[@]}" "\$@"
EOF

chmod +x "${TARGET_BIN}"

echo "==> 安装成功: ${TARGET_BIN}"

# 检查 PATH 环境
case ":${PATH}:" in
  *:"${INSTALL_DIR}":*) ;;
  *)
    echo ""
    echo "注意: ${INSTALL_DIR} 尚未包含在你的 PATH 环境变量中。"
    echo "你可以将以下内容添加到你的 ~/.bashrc 或 ~/.zshrc 中："
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    echo ""
    ;;
esac

echo "你可以随时运行 'hustnet help' 或 'hustnet status' 进行使用。"
