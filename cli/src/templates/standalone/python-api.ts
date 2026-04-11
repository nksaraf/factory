import type { TemplateVars, GeneratedFile } from "../types.js"
import { componentLabels, labelsToYaml } from "../compose-labels.js"
import { pythonQualityToml, pythonQualityFiles } from "../quality-configs.js"

export function generate(vars: TemplateVars): GeneratedFile[] {
  const { name, owner, description } = vars

  const files: GeneratedFile[] = []

  // pyproject.toml
  files.push({
    path: "pyproject.toml",
    content: `[project]
name = "${name}"
version = "0.1.0"
description = "${description}"
readme = "README.md"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "httpx>=0.27.0",
    "pydantic>=2.9.0",
    "pydantic-settings>=2.6.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src"]
${pythonQualityToml()}`,
  })

  // config/application.yml
  files.push({
    path: "config/application.yml",
    content: `app:
  name: ${name}
  host: \${APP_HOST:0.0.0.0}
  port: \${APP_PORT:8092}
  log_level: \${LOG_LEVEL:info}
`,
  })

  // Dockerfile
  files.push({
    path: "Dockerfile",
    content: `FROM python:3.12-slim AS base

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-dev

COPY . .

ENV PORT=8092
EXPOSE 8092

CMD ["uv", "run", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8092"]
`,
  })

  // docker-compose.yaml
  const svcLabels = componentLabels({
    type: "service",
    owner,
    description,
    runtime: "python",
    port: { number: 8092, name: "http", protocol: "tcp" },
  })

  files.push({
    path: "docker-compose.yaml",
    content: `services:
  ${name}:
    build: .
    ports:
      - "8092:8092"
    environment:
      APP_HOST: 0.0.0.0
      APP_PORT: "8092"
      LOG_LEVEL: info
    labels:
${labelsToYaml(svcLabels, 6)}
`,
  })

  // src/__init__.py
  files.push({
    path: "src/__init__.py",
    content: ``,
  })

  // src/main.py
  files.push({
    path: "src/main.py",
    content: `from contextlib import asynccontextmanager

from fastapi import FastAPI

from src.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    yield
    # Shutdown


app = FastAPI(
    title=settings.app_name,
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    return {"status": "ok"}
`,
  })

  // src/config.py
  files.push({
    path: "src/config.py",
    content: `from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "${name}"
    app_host: str = "0.0.0.0"
    app_port: int = 8092
    log_level: str = "info"

    class Config:
        env_prefix = ""
        case_sensitive = False


settings = Settings()
`,
  })

  // tests/__init__.py
  files.push({ path: "tests/__init__.py", content: "" })

  // Quality tooling configs
  files.push(...pythonQualityFiles())

  return files
}
