# Managing Infrastructure

Factory models infrastructure in two axes: **Estate** (ownership) and **Host + Realm** (control).

## Browsing Infrastructure

```bash
# Estate (ownership hierarchy)
dx infra estate list

# Hosts (machines)
dx infra host list

# Realms (control domains)
dx infra realm list

# Services (external APIs)
dx infra service list
```

## Registering a Host

```bash
dx infra host register \
  --name factory-prod \
  --type vm \
  --ip 192.168.2.88 \
  --os linux \
  --arch amd64 \
  --ssh-user lepton
```

## SSH Access

```bash
dx ssh factory-prod        # SSH by host slug
dx ssh my-workspace        # SSH to a workspace
```

dx resolves the slug to connection details via the EntityFinder.

## Infrastructure Scanning

```bash
dx scan                    # Scan local machine
dx scan --remote my-host   # Scan remote host
dx scan --json             # Structured output
```

Discovers and registers: OS, CPU, memory, disk, running services, Docker, Kubernetes, network interfaces.

## Fleet Management

```bash
# Sites
dx fleet site list
dx fleet site show production-us

# Tenants
dx fleet tenant list

# Workspaces
dx fleet workspace list
```

## Related

- [infra domain](/concepts/infra)
- [ops domain](/concepts/ops)
