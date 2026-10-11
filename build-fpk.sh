#!/bin/bash
# ============================================================
# Fndesk Lite - fpk 打包脚本
#
# 产物结构（fnOS 标准 fpk = tar.gz）：
#   app.tgz   -> 解包到 /var/apps/<appname>/target（server/ ui/ config/）
#   cmd/      -> 生命周期脚本
#   config/   -> privilege / resource
#   wizard/   -> 安装、设置、卸载向导
#   manifest  -> 应用元信息（版本号、更新日志）
#   ICON.PNG / ICON_256.PNG / LICENSE
#
# 用法：./build-fpk.sh [输出路径]
# ============================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_FPK="${1:-${ROOT_DIR}/fndesk.fpk}"
WORK_DIR="/tmp/fndesk-fpk-build"

APP_STAGE="${WORK_DIR}/appsrc"
PKG_STAGE="${WORK_DIR}/pkg"

echo "[build] 清理构建目录: ${WORK_DIR}"
mkdir -p "${WORK_DIR}" "${APP_STAGE}" "${PKG_STAGE}"
find "${WORK_DIR}" -mindepth 1 -delete
mkdir -p "${APP_STAGE}" "${PKG_STAGE}"

# ---------- 1. 组装应用负载 ----------
echo "[build] 组装应用负载 (server / ui / config)"
cp -a "${ROOT_DIR}/app/server" "${APP_STAGE}/server"
cp -a "${ROOT_DIR}/app/ui" "${APP_STAGE}/ui"
cp -a "${ROOT_DIR}/config" "${APP_STAGE}/config"

# 语法自检，避免把坏代码打进包
node --check "${APP_STAGE}/server/server.js"
node --check "${APP_STAGE}/server/app.js"
node --check "${APP_STAGE}/server/static/fndesk-desktop.js"

# ---------- 2. 组装 fpk 外层 ----------
echo "[build] 组装 fpk 外层文件"
cp -a "${ROOT_DIR}/manifest"        "${PKG_STAGE}/manifest"
cp -a "${ROOT_DIR}/LICENSE"         "${PKG_STAGE}/LICENSE"
cp -a "${ROOT_DIR}/ICON.PNG"        "${PKG_STAGE}/ICON.PNG"
cp -a "${ROOT_DIR}/ICON_256.PNG"    "${PKG_STAGE}/ICON_256.PNG"
cp -a "${ROOT_DIR}/cmd"             "${PKG_STAGE}/cmd"
cp -a "${ROOT_DIR}/config"          "${PKG_STAGE}/config"
cp -a "${ROOT_DIR}/wizard"          "${PKG_STAGE}/wizard"

# ---------- 3. 归一化权限 ----------
echo "[build] 归一化文件权限"
find "${WORK_DIR}" -type d -exec chmod 755 {} +
find "${WORK_DIR}" -type f -exec chmod 644 {} +
chmod 755 "${PKG_STAGE}/cmd/"*
chmod 755 "${APP_STAGE}/ui/index.cgi"
chmod 755 "${APP_STAGE}/server/fndesk_app/app/ui/index.cgi"
chmod 755 "${APP_STAGE}/server/fndesk_app/cmd/"*

# ---------- 4. 生成 app.tgz ----------
echo "[build] 生成 app.tgz"
tar -czf "${PKG_STAGE}/app.tgz" -C "${APP_STAGE}" server ui config

# ---------- 5. 打包 ----------
echo "[build] 打包 fpk -> ${OUT_FPK}"
tar -czf "${OUT_FPK}.tmp" -C "${PKG_STAGE}" \
  app.tgz LICENSE cmd config ICON.PNG ICON_256.PNG manifest wizard
mv -f "${OUT_FPK}.tmp" "${OUT_FPK}"
chmod 644 "${OUT_FPK}"

echo "[build] 完成"
ls -lh "${OUT_FPK}"
tar -tzf "${OUT_FPK}"
