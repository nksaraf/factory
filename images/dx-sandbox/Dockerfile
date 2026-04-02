# dx-sandbox: Cloud development environment with web terminal, web IDE, and AI tools.
# Published to ghcr.io/<org>/dx-sandbox:<tag>
FROM mcr.microsoft.com/devcontainers/base:ubuntu

ARG TTYD_VERSION=1.7.7
ARG OPENVSCODE_VERSION=1.109.5
ARG GO_VERSION=1.23.6
ARG NODE_MAJOR=22
ARG TARGETARCH

# ---------- System packages ----------
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl wget jq openssh-server sudo ca-certificates gnupg \
    python3-pip python3-venv \
    openjdk-21-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

# ---------- ttyd (web terminal) — static binary ~2MB ----------
RUN if [ "$TARGETARCH" = "arm64" ] || [ "$(uname -m)" = "aarch64" ]; then \
      curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.aarch64" \
        -o /usr/local/bin/ttyd; \
    else \
      curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64" \
        -o /usr/local/bin/ttyd; \
    fi && chmod +x /usr/local/bin/ttyd

# ---------- openvscode-server (web IDE) ----------
RUN if [ "$TARGETARCH" = "arm64" ] || [ "$(uname -m)" = "aarch64" ]; then \
      ARCH="arm64"; \
    else \
      ARCH="x64"; \
    fi && \
    curl -fsSL "https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${OPENVSCODE_VERSION}/openvscode-server-v${OPENVSCODE_VERSION}-linux-${ARCH}.tar.gz" \
      | tar xz -C /opt && \
    ln -s "/opt/openvscode-server-v${OPENVSCODE_VERSION}-linux-${ARCH}/bin/openvscode-server" /usr/local/bin/openvscode-server

# ---------- Node.js LTS ----------
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ---------- Go ----------
RUN if [ "$TARGETARCH" = "arm64" ] || [ "$(uname -m)" = "aarch64" ]; then \
      GOARCH="arm64"; \
    else \
      GOARCH="amd64"; \
    fi && \
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${GOARCH}.tar.gz" | tar xz -C /usr/local
ENV PATH="/usr/local/go/bin:${PATH}"

# ---------- Claude Code ----------
RUN npm install -g @anthropic-ai/claude-code

# ---------- dx CLI ----------
# TODO: Replace with published package once available:
#   RUN npm install -g @anthropic-ai/dx-cli
# For now, copy from build context or mount at runtime.
# COPY dx-cli /usr/local/bin/dx

# ---------- Entrypoint ----------
COPY entrypoint.sh /usr/local/bin/dx-entrypoint.sh
RUN chmod +x /usr/local/bin/dx-entrypoint.sh

EXPOSE 22 8080 8081

CMD ["/usr/local/bin/dx-entrypoint.sh"]
