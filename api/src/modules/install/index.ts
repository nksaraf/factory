import { Elysia } from "elysia"

const installScript = `#!/bin/sh
# Install script for dx CLI (lepton-dx)
# Usage: curl -fsSL https://factory.lepton.software/install | bash
set -e

PACKAGE_NAME="lepton-dx"
INSTALL_DIR="\${DX_INSTALL_DIR:-/usr/local/bin}"
BINARY_NAME="dx"

detect_platform() {
  OS="\$(uname -s)"
  ARCH="\$(uname -m)"

  case "\$OS" in
    Linux)  OS="linux" ;;
    Darwin) OS="darwin" ;;
    *)      echo "Error: unsupported OS: \$OS" >&2; exit 1 ;;
  esac

  case "\$ARCH" in
    x86_64|amd64)   ARCH="x64" ;;
    aarch64|arm64)   ARCH="arm64" ;;
    *)               echo "Error: unsupported architecture: \$ARCH" >&2; exit 1 ;;
  esac

  PLATFORM="\${OS}-\${ARCH}"
}

resolve_version() {
  VERSION="\${DX_VERSION:-}"
  if [ -z "\$VERSION" ]; then
    VERSION="\$(curl -fsSL "https://registry.npmjs.org/\${PACKAGE_NAME}/latest" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)"
  fi
  if [ -z "\$VERSION" ]; then
    echo "Error: could not resolve latest version" >&2
    exit 1
  fi
}

install() {
  NPM_PACKAGE="\${PACKAGE_NAME}-\${PLATFORM}"
  TARBALL_URL="https://registry.npmjs.org/\${NPM_PACKAGE}/-/\${NPM_PACKAGE}-\${VERSION}.tgz"

  case "\$PLATFORM" in
    linux-x64)    BINARY_FILE="lepton-dx-bun-linux-x64-baseline" ;;
    linux-arm64)  BINARY_FILE="lepton-dx-bun-linux-arm64" ;;
    darwin-x64)   BINARY_FILE="lepton-dx-bun-darwin-x64" ;;
    darwin-arm64) BINARY_FILE="lepton-dx-bun-darwin-arm64" ;;
    *)            echo "Error: no binary for \${PLATFORM}" >&2; exit 1 ;;
  esac

  TMPDIR="\$(mktemp -d)"
  trap 'rm -rf "\$TMPDIR"' EXIT

  echo "Installing dx v\${VERSION} (\${PLATFORM})..."

  curl -fsSL "\$TARBALL_URL" | tar -xz -C "\$TMPDIR"

  SRC="\${TMPDIR}/package/bin/\${BINARY_FILE}"

  if [ ! -f "\$SRC" ]; then
    echo "Error: binary not found in package" >&2
    exit 1
  fi

  if [ ! -d "\$INSTALL_DIR" ]; then
    mkdir -p "\$INSTALL_DIR" 2>/dev/null || sudo mkdir -p "\$INSTALL_DIR"
  fi

  if [ -w "\$INSTALL_DIR" ]; then
    cp "\$SRC" "\${INSTALL_DIR}/\${BINARY_NAME}"
    chmod +x "\${INSTALL_DIR}/\${BINARY_NAME}"
  else
    echo "Installing to \${INSTALL_DIR} (requires sudo)..."
    sudo cp "\$SRC" "\${INSTALL_DIR}/\${BINARY_NAME}"
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
resolve_version
install
`

export const installController = new Elysia().get("/install", () => {
  return new Response(installScript, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
})
