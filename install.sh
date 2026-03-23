#!/usr/bin/env bash
  set -euo pipefail

  APP_NAME="${1:-myhapi}"
  INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
  OS="$(uname -s)"

  case "$OS" in
      Linux|Darwin) ;;
      *)
          echo "错误：这个脚本只支持 Linux 和 macOS"
          exit 1
          ;;
  esac

  if ! [[ "$APP_NAME" =~ ^[a-zA-Z0-9._-]+$ ]]; then
      echo "错误：命令名只能包含字母、数字、点、下划线、横杠"
      exit 1
  fi

  if ! command -v bun >/dev/null 2>&1; then
      echo "错误：未检测到 bun，请先安装 Bun"
      echo "参考: https://bun.sh"
      exit 1
  fi

  if command -v git >/dev/null 2>&1 && git rev-parse --show-toplevel >/dev/null 2>&1; then
      REPO_ROOT="$(git rev-parse --show-toplevel)"
  else
      REPO_ROOT="$(pwd)"
  fi

  cd "$REPO_ROOT"

  if [[ ! -f package.json || ! -d cli || ! -d hub || ! -d web ]]; then
      echo "错误：请在 hapi fork 仓库内运行这个脚本"
      exit 1
  fi

  echo "==> 系统: $OS ($(uname -m))"
  echo "==> 仓库目录: $REPO_ROOT"
  echo "==> 命令名称: $APP_NAME"
  echo "==> 安装目录: $INSTALL_DIR"

  echo "==> bun install"
  bun install

  echo "==> build single exe"
  bun run build:single-exe

  BIN_PATH=""
  if [[ "$OS" == "Darwin" ]]; then
      CANDIDATES=(
          "$REPO_ROOT/cli/dist-exe/bun-darwin-arm64/hapi"
          "$REPO_ROOT/cli/dist-exe/bun-darwin-x64/hapi"
      )
  else
      CANDIDATES=(
          "$REPO_ROOT/cli/dist-exe/bun-linux-x64-baseline/hapi"
          "$REPO_ROOT/cli/dist-exe/bun-linux-arm64/hapi"
          "$REPO_ROOT/cli/dist-exe/bun-linux-x64-modern/hapi"
      )
  fi

  for f in "${CANDIDATES[@]}"; do
      if [[ -f "$f" ]]; then
          BIN_PATH="$f"
          break
      fi
  done

  if [[ -z "$BIN_PATH" ]]; then
      BIN_PATH="$(find "$REPO_ROOT/cli/dist-exe" -type f -name hapi | head -n 1 || true)"
  fi

  if [[ -z "$BIN_PATH" || ! -f "$BIN_PATH" ]]; then
      echo "错误：构建完成，但没有找到二进制产物"
      exit 1
  fi

  TARGET="$INSTALL_DIR/$APP_NAME"
  BACKUP=""

  if [[ -e "$TARGET" ]]; then
      BACKUP="${TARGET}.bak.$(date +%Y%m%d%H%M%S)"
      echo "==> 备份旧文件: $TARGET -> $BACKUP"
      sudo cp "$TARGET" "$BACKUP"
  fi

  echo "==> 安装二进制"
  sudo mkdir -p "$INSTALL_DIR"
  sudo install -m 755 "$BIN_PATH" "$TARGET"

  echo
  echo "完成。"
  echo "二进制: $BIN_PATH"
  echo "安装到: $TARGET"
  if [[ -n "$BACKUP" ]]; then
      echo "备份:   $BACKUP"
  fi

  echo
  echo "现在你可以这样用："
  echo "  $APP_NAME hub"
  echo "  $APP_NAME"
