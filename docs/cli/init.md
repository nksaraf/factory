# dx init

## Synopsis

```
dx init [directory] [flags]
```

## Description

Scaffold a new project, service, website, or library with the correct Factory conventions. `dx init` is interactive when run in a TTY — it guides you through selecting a project type, runtime, framework, and owner. In non-TTY environments (CI, scripts), provide all required flags explicitly.

The generated project includes a `docker-compose.yaml` with catalog labels, a `package.json` with `dx` config, and a framework-specific starter. Supported types:

- **project** — a full multi-service project (docker-compose based)
- **service** — a single API or backend service
- **website** — a frontend application
- **library** — a shared library package

## Flags

| Flag          | Short | Type    | Description                                                                    |
| ------------- | ----- | ------- | ------------------------------------------------------------------------------ |
| `--type`      | `-t`  | string  | Type: `project`, `service`, `website`, `library`                               |
| `--runtime`   | `-r`  | string  | Runtime: `node`, `java`, `python`                                              |
| `--framework` | `-f`  | string  | Framework: `elysia`, `spring-boot`, `fastapi`, `react-vinxi`, `react-tailwind` |
| `--name`      | `-n`  | string  | Project name                                                                   |
| `--owner`     | `-o`  | string  | Owner/team                                                                     |
| `--force`     |       | boolean | Overwrite existing files                                                       |
| `--dir`       | `-C`  | string  | Target directory                                                               |

## Examples

```bash
# Interactive setup
dx init

# Create a project in a new directory
dx init my-platform

# Create a Node.js API service
dx init my-api --type service --runtime node --framework elysia

# Create a Python FastAPI service
dx init my-api --type service --runtime python --framework fastapi

# Create a React frontend
dx init my-app --type website --runtime node --framework react-tailwind

# Create a Spring Boot service
dx init my-svc --type service --runtime java --framework spring-boot

# Create with a specific owner
dx init my-lib --type library --runtime node --owner platform-team
```

## Related Commands

- [`dx up`](/cli/up) — Start the infrastructure for your new project
- [`dx dev`](/cli/dev) — Start dev servers
- [`dx catalog`](/cli/catalog) — Browse the software catalog generated from your project
