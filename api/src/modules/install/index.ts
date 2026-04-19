import { Elysia } from "elysia"

const installScript = `#!/bin/sh
# Install script for dx CLI (lepton-dx)
# Usage: curl -fsSL https://factory.lepton.software/api/v1/factory/install | bash
set -e

PACKAGE_NAME="lepton-dx"
BINARY_NAME="dx"

detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Linux)                OS="linux" ;;
    Darwin)               OS="darwin" ;;
    MINGW*|MSYS*|CYGWIN*) OS="windows"; BINARY_NAME="dx.exe" ;;
    *)                    echo "Error: unsupported OS: $OS" >&2; exit 1 ;;
  esac

  case "$ARCH" in
    x86_64|amd64)   ARCH="x64" ;;
    aarch64|arm64)   ARCH="arm64" ;;
    *)               echo "Error: unsupported architecture: $ARCH" >&2; exit 1 ;;
  esac

  IS_MUSL=0
  if [ "$OS" = "linux" ] && ([ -f /lib/ld-musl-x86_64.so.1 ] || [ -f /lib/ld-musl-aarch64.so.1 ]); then
    if ! [ -f /lib64/ld-linux-x86-64.so.2 ] && ! [ -f /lib/ld-linux-aarch64.so.1 ]; then
      IS_MUSL=1
    fi
  fi

  PLATFORM="\${OS}-\${ARCH}"

  if [ -z "\${DX_INSTALL_DIR:-}" ]; then
    case "$OS" in
      windows) INSTALL_DIR="\${LOCALAPPDATA:-$HOME/AppData/Local}/dx/bin" ;;
      *)       INSTALL_DIR="/usr/local/bin" ;;
    esac
  else
    INSTALL_DIR="$DX_INSTALL_DIR"
  fi
}

ensure_musl_compat() {
  [ "$IS_MUSL" = "1" ] || return 0

  if [ -f /lib64/ld-linux-x86-64.so.2 ] || [ -f /lib/ld-linux-aarch64.so.1 ]; then
    return 0
  fi

  if ! command -v apk >/dev/null 2>&1; then
    echo "Error: musl libc detected but apk not available." >&2
    echo "dx binaries are glibc-linked. Install a glibc compatibility layer manually." >&2
    exit 1
  fi

  echo "Alpine/musl detected — installing glibc compat (gcompat libstdc++ libgcc ca-certificates)..."
  if [ "$(id -u)" = "0" ]; then
    apk add --no-cache gcompat libstdc++ libgcc ca-certificates >/dev/null
  elif command -v sudo >/dev/null 2>&1; then
    sudo apk add --no-cache gcompat libstdc++ libgcc ca-certificates >/dev/null
  else
    echo "Error: need root to run 'apk add gcompat libstdc++ libgcc'." >&2
    exit 1
  fi
}

resolve_version() {
  VERSION="\${DX_VERSION:-}"
  if [ -z "$VERSION" ]; then
    VERSION="$(curl -fsSL "https://registry.npmjs.org/\${PACKAGE_NAME}/latest" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)"
  fi
  if [ -z "$VERSION" ]; then
    echo "Error: could not resolve latest version" >&2
    exit 1
  fi
}

install() {
  NPM_PACKAGE="\${PACKAGE_NAME}-\${PLATFORM}"
  TARBALL_URL="https://registry.npmjs.org/\${NPM_PACKAGE}/-/\${NPM_PACKAGE}-\${VERSION}.tgz"

  case "$PLATFORM" in
    linux-x64)    BINARY_FILE="lepton-dx-bun-linux-x64-baseline" ;;
    linux-arm64)  BINARY_FILE="lepton-dx-bun-linux-arm64" ;;
    darwin-x64)   BINARY_FILE="lepton-dx-bun-darwin-x64" ;;
    darwin-arm64) BINARY_FILE="lepton-dx-bun-darwin-arm64" ;;
    windows-x64)  BINARY_FILE="lepton-dx-bun-windows-x64-baseline.exe" ;;
    *)            echo "Error: no binary for \${PLATFORM}" >&2; exit 1 ;;
  esac

  TMPDIR="$(mktemp -d)"
  trap 'rm -rf "$TMPDIR"' EXIT

  echo "Installing dx v\${VERSION} (\${PLATFORM})..."

  curl -fsSL "$TARBALL_URL" | tar -xz -C "$TMPDIR"

  SRC="\${TMPDIR}/package/bin/\${BINARY_FILE}"

  if [ ! -f "$SRC" ]; then
    echo "Error: binary not found in package" >&2
    exit 1
  fi

  if [ ! -d "$INSTALL_DIR" ]; then
    mkdir -p "$INSTALL_DIR" 2>/dev/null || sudo mkdir -p "$INSTALL_DIR"
  fi

  if [ "$OS" = "windows" ]; then
    cp "$SRC" "\${INSTALL_DIR}/\${BINARY_NAME}"
  elif [ -w "$INSTALL_DIR" ]; then
    cp "$SRC" "\${INSTALL_DIR}/\${BINARY_NAME}"
    chmod +x "\${INSTALL_DIR}/\${BINARY_NAME}"
  else
    echo "Installing to \${INSTALL_DIR} (requires sudo)..."
    sudo cp "$SRC" "\${INSTALL_DIR}/\${BINARY_NAME}"
    sudo chmod +x "\${INSTALL_DIR}/\${BINARY_NAME}"
  fi

  echo "dx v\${VERSION} installed to \${INSTALL_DIR}/\${BINARY_NAME}"

  if command -v dx >/dev/null 2>&1; then
    echo "Run 'dx setup' to get started."
  else
    echo "Note: \${INSTALL_DIR} is not in your PATH. Add it or move the binary."
  fi
}

detect_platform
ensure_musl_compat
resolve_version
install
`

export const installController = new Elysia().get(
  "/api/v1/factory/install",
  () => {
    return new Response(installScript, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }
)
