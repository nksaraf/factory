# Onboarding an Existing Project

Install dx on an existing project and get a structured development workflow.

## Quick Start

```bash
# Install dx
curl -fsSL https://get.factory.lepton.software | sh
dx setup

# Connect to Factory
cd /path/to/your/project
dx install --role workbench

# Start working
dx status
dx up && dx dev
```

## Scenarios

### A: Existing Docker Compose App

Your app already runs via `docker-compose.yaml`. dx works with this directly.

```bash
dx install --role workbench
dx status              # Shows discovered components and resources
```

Add catalog labels to your existing compose for full dx integration:

```yaml
services:
  api:
    build: ./api
    labels:
      dx.type: service
      dx.owner: my-team
      dx.dev.command: "npm run dev"
      dx.test: "npm test"
```

### B: Bare VM

```bash
# Install dx
curl -fsSL https://get.factory.lepton.software | sh
dx setup

# Install Docker if needed
dx run @dx/docker

# Set up workbench
dx install --role workbench
```

### C: systemd/PM2 App (No Docker)

Create a minimal docker-compose.yaml for dev infrastructure even if your app doesn't use Docker:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_PASSWORD: dev
```

Then `dx up` manages your dev infrastructure while your app runs natively.

## Related

- [New Project](/guides/new-project)
- [Project Structure](/getting-started/project-structure)
