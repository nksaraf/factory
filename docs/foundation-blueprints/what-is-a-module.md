`module` is a **core entity** and must exist at the **Factory level**.
It was implicitly referenced but not explicitly defined earlier. The platform cannot function without it because modules are the **unit of product capability and deployment**.

`module` sits between **Product, Build, Fleet, and Site planes** and is one of the most important cross-plane entities.

---

# 1. Core Product Entity: Module

A **module** represents a deployable product capability.

Examples:

- geoanalytics
- traffic-engine
- network-planner
- auth-service
- workflow-engine

A module normally corresponds to a **service or group of services** that provide a cohesive capability.

Modules are:

- designed in **Product Plane**
- built in **Build Plane**
- deployed via **Fleet Plane**
- executed in **Service Plane**

---

# 2. Module Entities

### Module

```
module
------
module_id (PK)
name
description
owner_team
lifecycle_state
created_at
```

Represents a logical capability.

---

### Module Version

```
module_version
--------------
module_version_id (PK)
module_id (FK)
version
compatibility_range
schema_version
release_notes
created_at
```

Represents a specific buildable version.

---

### Module Artifact

```
artifact
--------
artifact_id
module_version_id
artifact_type
image_digest
registry
```

Examples:

- api container
- worker container
- UI bundle
- CLI

---

### Module Dependency

Modules can depend on other modules.

```
module_dependency
-----------------
module_version_id
depends_on_module_version_id
dependency_type
```

Relationship:

```
module_version N — M module_version
```

---

# 3. Module Relationships Across Planes

## Product Plane

Defines modules and their roadmap.

```
module 1 — N module_roadmap_item
module N — M release_plan
```

---

## Build Plane

Builds module versions.

```
repo N — 1 module
module 1 — N module_version
module_version 1 — N artifact
build 1 — N artifact
```

PRs ultimately modify a module's codebase.

```
pull_request N — 1 repo
repo N — 1 module
```

---

## Fleet Plane

Fleet deploys module versions as part of releases.

```
release 1 — N release_module_pin
release_module_pin N — 1 module_version
```

A release is basically a **collection of module versions**.

---

## Site Service Plane

Modules run as module instances.

```
module_instance
---------------
module_instance_id
namespace_id
module_version_id
status
config
```

Relationship:

```
namespace 1 — N module_instance
module_version 1 — N module_instance
```

---

# 4. Full Module Lifecycle

### Product definition

```
module created
```

Example:

```
geoanalytics
```

---

### Development

PRs modify code in the repo associated with the module.

```
repo → module
PR → repo
```

---

### Build

CI produces artifacts for module versions.

```
module_version → artifact
```

Example:

```
geoanalytics-service:2.3.0
geoanalytics-worker:2.3.0
```

---

### Release

Fleet bundles versions into a release.

```
release
 ├ geoanalytics 2.3
 ├ auth-service 1.4
 └ workflow-engine 3.1
```

---

### Deployment

Site creates runtime instances.

```
namespace
 ├ module_instance geoanalytics
 └ module_instance workflow
```

---

# 5. Critical Relationships

```
module 1 — N module_version
module_version 1 — N artifact
repo N — 1 module
pull_request N — 1 repo
release 1 — N release_module_pin
release_module_pin N — 1 module_version
namespace 1 — N module_instance
module_version 1 — N module_instance
```

---

# 6. Where Module Lives

**Factory**

Module definition lives here.

```
Factory
├ Product Plane
│  └ module
│
├ Build Plane
│  └ module_version
│
└ Fleet Plane
   └ release_module_pin
```

---

**Site**

Runtime instances.

```
Site
└ Service Plane
   └ module_instance
```

---

# 7. Why Module Is Central

Without `module`:

- releases cannot be defined
- deployments cannot be structured
- entitlements cannot target features
- build artifacts cannot map to product capabilities

The module entity connects **four planes simultaneously**.

```
Product → module
Build → module_version
Fleet → release_module_pin
Service → module_instance
```

---

# 8. Mental Model

Think of modules like **packages in a product operating system**.

Example:

```
Traffic Platform

Modules
- ingestion
- analytics
- dashboard
- auth
- workflow
```

Each module:

- evolves independently
- has its own code
- has its own runtime
- can be enabled per customer

---

# 9. Simplified Core Graph

```
module
   │
   ├── module_version
   │        │
   │        └── artifact
   │
   ├── repo
   │        └── pull_request
   │
   └── module_instance
```

---

# 10. Important Future Extension

Eventually you will likely add:

```
module_capability
feature_flag
module_config_schema
```

Allowing:

- feature gating
- dynamic module configuration
- product tiering
