# Product Requirements Document

# **Build Plane (Company-Wide Software Construction and Artifact Production)**

---

# 1. Purpose

The Build Plane is the company-wide system that governs how all software is constructed, tested, versioned, signed, and packaged for deployment.

It is responsible for:

- Source control standards and repository management
- CI/CD pipeline execution
- Artifact production (container images, binaries, bundles)
- Artifact signing and provenance
- Versioning and dependency management
- Security scanning and compliance gates
- SBOM generation
- Test execution and quality gates
- Service Plane SDK production and distribution
- Air-gapped release bundle generation

It does **not**:

- Define what gets built or why (Product Plane)
- Decide where software runs (Fleet Plane)
- Manage runtime behavior (Service Plane)
- Provision infrastructure (Infrastructure Plane)
- Manage agent execution or identity (Agent Plane)

---

# 2. Design Principles

1. One build system for all products. The product is a parameter, not a separate workflow.
2. Every artifact is immutable, versioned, signed, and traceable to a commit.
3. Builds are reproducible. Same inputs produce same outputs.
4. Security scanning is mandatory and blocking, not advisory.
5. The SDK is the contract between Factory and Service Plane. No module bypasses it.
6. Air-gapped release bundles are first-class outputs, not afterthoughts.
7. Repository structure follows the hybrid model: shared libraries in a monorepo, modules in dedicated repos.
8. Pipeline definitions are code, stored alongside the source they build.
9. All artifact metadata is machine-readable and queryable.
10. Build Plane has no runtime dependencies on external SaaS services. Self-hosted runners, self-hosted registry, self-hosted scanning.

---

# 3. Core Concepts

## 3.1 Repository

A versioned source code store.

Two categories:

- **Platform monorepo** — contains shared libraries, SDK source, platform tooling, pipeline templates, and infrastructure-as-code.
- **Module repos** — one repository per module. Contains module-specific source, tests, and pipeline configuration that extends platform templates.

Every repository has a defined owner (team or individual), branch protection rules, and code review requirements.

---

## 3.2 Module

A deployable product capability. The unit of build, version, and release.

Module is defined in Product Plane. Build Plane builds it. Fleet Plane deploys it.

Each module maps to one or more repositories. Each module produces one or more artifacts per version.

---

## 3.3 Module Version

A specific, buildable snapshot of a module.

Identified by semantic version. Tied to a specific commit (or set of commits across repos if the module spans multiple). Carries compatibility metadata declaring which other module versions it can coexist with.

---

## 3.4 Artifact

An immutable, deployable output of a build.

Types:

- Container image (API server, worker, sidecar)
- Frontend bundle (SPA, micro-frontend)
- CLI binary
- Helm chart
- Migration package (schema migrations, data migrations)
- Documentation bundle
- SDK package

Every artifact has:

- A digest (content-addressable hash)
- A signature (provenance)
- An SBOM (dependency inventory)
- A link to the build that produced it
- A link to the module version it belongs to

---

## 3.5 Build

A recorded execution of a CI pipeline that produces artifacts.

Every build captures:

- Trigger (commit, PR, tag, manual, scheduled)
- Input (commit SHA, branch, environment variables)
- Steps executed
- Test results
- Security scan results
- Artifacts produced
- Duration
- Pass/fail status

---

## 3.6 Release Bundle

A collection of module version pins, their artifacts, and supporting materials packaged for deployment.

Release bundles are the handoff from Build Plane to Fleet Plane.

Two forms:

- **Release manifest** — a declarative document listing module versions and artifact references. Used for connected deployments where Fleet pulls artifacts from registry.
- **Offline release bundle** — a self-contained archive containing all container images, Helm charts, migrations, SBOMs, license bundles, and documentation. Used for air-gapped deployments.

---

## 3.7 Service Plane SDK

A shared framework that all product modules are built on.

The SDK enforces:

- Module registration and lifecycle hooks
- Tenant context propagation (from Control Plane)
- Telemetry emission (OpenTelemetry)
- Data Plane access patterns
- API surface declaration
- Health check contracts
- Configuration schema declaration
- Event production and consumption patterns

The SDK is versioned independently. Module versions declare which SDK version they target. SDK compatibility is a build-time check.

---

# 4. Functional Requirements

---

## 4.1 Source Control

### 4.1.1 Repository Structure

The hybrid model:

**Platform monorepo** contains:

```
platform/
├── sdk/                    # Service Plane SDK source
├── libs/                   # Shared libraries
│   ├── auth-client/        # Control Plane auth client
│   ├── data-client/        # Data Plane client
│   ├── telemetry/          # OpenTelemetry wrappers
│   ├── config/             # Configuration framework
│   └── testing/            # Shared test utilities
├── tools/                  # Build tooling, CLI tools
├── templates/              # Pipeline templates
│   ├── ci/                 # CI pipeline templates
│   ├── helm/               # Base Helm chart templates
│   └── docker/             # Base Dockerfiles
├── infra/                  # Infrastructure-as-code
└── docs/                   # Platform documentation
```

**Module repos** follow a standard layout:

```
module-{name}/
├── cmd/                    # Entry points (if Go)
│   ├── api/
│   └── worker/
├── internal/               # Module-specific business logic
├── pkg/                    # Exported packages (if any)
├── migrations/             # Database migrations
├── deploy/                 # Helm chart (extends base template)
├── tests/
│   ├── unit/
│   ├── integration/
│   └── contract/
├── .pipeline.yaml          # Pipeline config (extends template)
├── module.yaml             # Module metadata
└── sdk.lock                # Pinned SDK version
```

### 4.1.2 module.yaml

Every module repo must contain a `module.yaml` at the root:

```yaml
module:
  name: geoanalytics
  owner: geo-team
  product: smartmarket # which product this module belongs to

artifacts:
  - name: geoanalytics-api
    type: container
    dockerfile: deploy/Dockerfile.api
  - name: geoanalytics-worker
    type: container
    dockerfile: deploy/Dockerfile.worker
  - name: geoanalytics-ui
    type: frontend-bundle

sdk:
  version: "^1.4.0" # required SDK compatibility

dependencies:
  - module: auth-service
    version: ">=1.2.0"
  - module: workflow-engine
    version: ">=3.0.0"

migrations:
  engine: sql
  path: migrations/
```

### 4.1.3 Branch Policy

All repos must enforce:

- `main` is protected. No direct pushes.
- All changes via pull request.
- Minimum one approval required.
- CI must pass before merge.
- Linear history (squash or rebase merge).

Module repos additionally require:

- CODEOWNERS file mapping directories to reviewers.
- Signed commits (optional, recommended for Phase 2).

### 4.1.4 Code Ownership

Every directory in every repository must have a defined owner via CODEOWNERS.

Platform monorepo has per-directory ownership. Module repos have module-team ownership with optional per-directory overrides.

---

## 4.2 CI/CD Pipelines

### 4.2.1 Pipeline Architecture

Pipelines follow a template-and-extend model:

- **Pipeline templates** live in the platform monorepo under `templates/ci/`.
- **Module pipelines** extend templates by referencing them in `.pipeline.yaml` and adding module-specific steps.

This ensures consistency across all modules while allowing module-specific customization.

### 4.2.2 Pipeline Types

**Commit pipeline** — runs on every commit to a PR branch:

1. Lint
2. Unit tests
3. Build (compile, bundle)
4. Security scan (dependency check, SAST)
5. Report results to PR

**Merge pipeline** — runs when PR merges to main:

1. Full build
2. Unit tests
3. Integration tests
4. Security scan (full)
5. SBOM generation
6. Artifact production
7. Artifact signing
8. Push to registry
9. Update module version record

**Release pipeline** — runs when a release tag is created:

1. Full build from tagged commit
2. All test suites (unit, integration, contract, performance)
3. Full security scan
4. SBOM generation
5. Artifact production
6. Artifact signing
7. Vulnerability report generation
8. Push to registry
9. Offline bundle generation (if applicable)
10. Create release record

**Nightly pipeline** — scheduled:

1. Full build of main
2. All test suites
3. Dependency vulnerability rescan
4. Performance regression tests
5. Report drift

### 4.2.3 Pipeline Execution

All pipelines run on self-hosted runners.

Runners must:

- Be ephemeral (fresh environment per build)
- Have no persistent state between builds
- Support container-based build steps
- Have access to the internal registry (pull base images, push artifacts)
- Have no outbound internet access during build (supply chain security). All dependencies resolved from internal mirrors.

### 4.2.4 Pipeline as Code

Pipeline definitions are YAML, stored in source control, reviewed via PR.

Template example:

```yaml
# templates/ci/module-pipeline.yaml
stages:
  - lint
  - test
  - build
  - scan
  - publish

lint:
  steps:
    - run: platform-lint
    - run: module-lint

test:
  steps:
    - run: unit-tests
    - run: integration-tests
      when: merge | release

build:
  steps:
    - run: compile
    - run: docker-build
      artifacts: from module.yaml

scan:
  steps:
    - run: dependency-scan
    - run: sast
    - run: license-check
    - run: sbom-generate
      when: merge | release

publish:
  when: merge | release
  steps:
    - run: sign-artifacts
    - run: push-registry
    - run: record-build
```

Module override example:

```yaml
# module-geoanalytics/.pipeline.yaml
extends: module-pipeline

test:
  steps:
    - inherit: all
    - run: spatial-integration-tests
      when: merge | release
    - run: tile-generation-benchmark
      when: release
```

---

## 4.3 Artifact Production

### 4.3.1 Container Images

All container images must:

- Use a company-approved base image (hardened, minimal, regularly patched).
- Include no build tools or compilers in the final image (multi-stage builds).
- Run as non-root user.
- Have a health check endpoint.
- Include OCI labels for traceability:

```
org.opencontainers.image.source = <repo-url>
org.opencontainers.image.revision = <commit-sha>
org.opencontainers.image.version = <semver>
com.platform.module = <module-name>
com.platform.build-id = <build-id>
com.platform.sdk-version = <sdk-version>
```

### 4.3.2 Frontend Bundles

Frontend artifacts must:

- Be static, deployable bundles (no server-side rendering requirement at build time).
- Include source maps (stored separately, not shipped to production).
- Include integrity hashes per file.
- Be versioned consistently with their parent module version.

### 4.3.3 Helm Charts

Every module produces a Helm chart that:

- Extends the base chart template from the platform monorepo.
- Declares resource requirements (CPU, memory, storage).
- Declares dependencies on other modules (if any).
- Supports namespace-scoped deployment (tenant isolation).
- Includes values files for each deployment model (SaaS shared, dedicated, self-hosted).
- Passes `helm lint` and `helm template` validation.

### 4.3.4 Migration Packages

Database and schema migrations must:

- Be versioned and ordered.
- Support forward-only migration (no down migrations in production).
- Follow the expand/contract pattern for zero-downtime changes.
- Include validation scripts that verify migration success.
- Be packaged as a separate artifact (not embedded in the application image).

### 4.3.5 Artifact Registry

Build Plane operates a self-hosted artifact registry.

Registry must:

- Store container images (OCI-compliant).
- Store Helm charts.
- Store generic artifacts (binaries, bundles).
- Support content-addressable storage (by digest).
- Support tag immutability (once a version tag is pushed, it cannot be overwritten).
- Support garbage collection of untagged artifacts.
- Support replication to secondary registries (for regional or air-gapped distribution).
- Enforce access control (service accounts for push, broader read access for pull).

### 4.3.6 Artifact Signing

All artifacts pushed to the registry must be signed.

Signing must:

- Use a Build Plane signing key (managed by Infrastructure Plane PKI).
- Produce a verifiable signature stored alongside the artifact.
- Be verified by Fleet Plane before deployment.
- Be verified by Site during air-gapped installation.

Signing model: keyless (Sigstore/Cosign style) preferred. If not feasible in air-gapped environments, fall back to key-based signing with key distribution via entitlement bundles.

---

## 4.4 Service Plane SDK

### 4.4.1 SDK Scope

The SDK is the contract between the platform and all product modules. Every module must build against the SDK. The SDK provides:

**Module lifecycle:**

- Registration (module declares its identity, version, capabilities)
- Startup hooks (initialization, dependency checks)
- Shutdown hooks (graceful termination, resource cleanup)
- Health check interface

**Tenant context:**

- Middleware that extracts tenant context from incoming requests (set by Control Plane)
- Propagation of tenant context across async boundaries (background jobs, event handlers)
- Enforcement: no request can be processed without resolved tenant context (unless explicitly marked as system-scoped)

**Data access:**

- Database connection pool with automatic tenant context injection (sets `app.current_tenant` for RLS)
- Object storage client with automatic tenant-scoped key prefixing
- Cache client with automatic tenant-scoped key namespacing
- Query timeout enforcement

**Telemetry:**

- Structured logging with tenant context automatically attached
- Metrics emission (OpenTelemetry)
- Distributed tracing (span propagation, tenant attribution)

**API declaration:**

- Route registration
- Request/response validation
- API versioning support
- Error response formatting (consistent error shape across all modules)

**Event system:**

- Event production (publish domain events to event stream)
- Event consumption (subscribe to events from other modules or platform)
- Event schema declaration and validation

**Configuration:**

- Module config schema declaration
- Tier 3 (application) config read/write
- Feature flag evaluation (from Control Plane entitlements)

**Background work:**

- Job registration and execution
- Queue consumer patterns
- Retry and dead-letter handling
- Quota reservation before heavy operations

### 4.4.2 SDK Versioning

The SDK is semantically versioned independently of any module or product.

- Major version: breaking changes to the module contract.
- Minor version: new capabilities, backward-compatible.
- Patch version: bug fixes.

Module repos pin their SDK version in `sdk.lock`. Build pipeline validates compatibility at build time.

SDK must support at least N-1 major versions simultaneously (modules are not forced to upgrade immediately on major SDK release).

### 4.4.3 SDK Language Support

The SDK must be available in the primary platform language.

Language decision is open. Candidates:

- **Go** — strong fit for service infrastructure, low resource overhead, single-binary deployment.
- **Python** — required if ML/analytics modules need native integration without FFI boundaries.
- **TypeScript** — required if frontend modules or lightweight API modules use Node.js runtime.

Phase 1 recommendation: ship SDK in one language. Add additional language support in Phase 2 only if module requirements demand it.

If multi-language support is required, the SDK defines a language-agnostic contract (gRPC or HTTP interface contracts) and provides language-specific client libraries that implement the contract.

### 4.4.4 SDK Distribution

SDK packages are published to the internal artifact registry.

Module repos consume the SDK as a dependency (Go module, npm package, pip package — depending on language).

SDK source lives in the platform monorepo under `sdk/`.

---

## 4.5 Versioning and Dependency Management

### 4.5.1 Semantic Versioning

All modules follow semantic versioning (semver).

Version bumps are determined by:

- Breaking API change → major
- New feature, backward-compatible → minor
- Bug fix → patch

Version is declared in `module.yaml` and enforced by the pipeline.

### 4.5.2 Module Dependency Graph

Modules declare dependencies on other modules in `module.yaml`.

Dependency declarations include:

- Target module name
- Version range (semver range)
- Dependency type: `required` (must be co-deployed) or `optional` (enhances functionality if present)

Build Plane maintains a dependency graph and validates:

- No circular dependencies.
- All required dependencies are satisfiable within a given release.
- Breaking version bumps in a dependency trigger warnings on dependent modules.

### 4.5.3 Compatibility Matrix

Build Plane maintains a compatibility matrix:

```
module_version_compatibility
-----------------------------
module_version_id
compatible_with_module_version_id
compatibility_type (tested | declared | inferred)
```

Compatibility is:

- **Tested** — integration tests between the two versions passed.
- **Declared** — module author asserts compatibility.
- **Inferred** — no breaking API changes detected between versions.

Fleet Plane consults this matrix when constructing releases.

### 4.5.4 SDK Compatibility

Every module version declares its target SDK version range.

Build pipeline rejects builds where:

- Module uses SDK APIs not available in its declared range.
- Module's declared SDK range is no longer supported (older than N-1 major).

---

## 4.6 Security and Compliance

### 4.6.1 Dependency Scanning

Every build scans all dependencies for known vulnerabilities.

Scanning must:

- Run against a vulnerability database updated at least daily.
- Block builds with critical or high severity vulnerabilities (configurable threshold).
- Produce a machine-readable vulnerability report attached to the build record.
- Support exception management (known-accepted vulnerabilities with expiry dates).

### 4.6.2 Static Analysis (SAST)

Every build runs static analysis.

SAST must:

- Check for common security anti-patterns (injection, secrets in code, unsafe deserialization).
- Enforce language-specific linting rules.
- Block builds that introduce new critical findings.
- Produce a report attached to the build record.

### 4.6.3 SBOM Generation

Every release build generates an SBOM.

SBOM must:

- Follow SPDX or CycloneDX format.
- List all direct and transitive dependencies with versions and licenses.
- Be stored alongside the artifact in the registry.
- Be included in offline release bundles.

### 4.6.4 License Compliance

Every build checks dependency licenses.

License check must:

- Maintain an approved license allowlist (MIT, Apache 2.0, BSD, etc.).
- Flag copyleft licenses (GPL, AGPL) for review.
- Block builds with unapproved licenses unless an exception is recorded.

### 4.6.5 Secret Detection

Every commit pipeline scans for accidentally committed secrets.

Must detect:

- API keys, tokens, passwords in source.
- Private keys, certificates.
- Connection strings with credentials.

Findings block the PR from merging.

---

## 4.7 Testing Infrastructure

### 4.7.1 Test Tiers

**Unit tests** — run on every commit. Fast, isolated, no external dependencies.

**Integration tests** — run on merge and release. Test module against real dependencies (database, cache, message queue) using containers.

**Contract tests** — run on merge and release. Verify that module API contracts (request/response shapes, event schemas) have not broken.

**Performance tests** — run on release and nightly. Benchmark critical paths. Detect regressions against baseline.

**Tenant isolation tests** — run on merge and release. Verify that SDK tenant scoping works correctly. No cross-tenant data leakage under concurrent load.

### 4.7.2 Test Environments

Build Plane provisions ephemeral test environments for integration and contract tests.

Test environments must:

- Be created per build run.
- Include necessary infrastructure (database, cache, queue) as containers.
- Be destroyed after the build completes.
- Have no shared state between builds.

### 4.7.3 Test Reporting

All test results must:

- Be stored as structured reports attached to the build record.
- Be queryable (pass rate per module, flaky test detection, coverage trends).
- Be visible in PR status checks.

### 4.7.4 Quality Gates

A build is blocked from producing release-grade artifacts if:

- Unit test coverage drops below threshold (configurable per module, default 70%).
- Any integration test fails.
- Any contract test fails.
- Any critical security finding is unresolved.
- SBOM generation fails.

Quality gate configuration is stored in `module.yaml` and can be overridden (stricter only) at the platform level.

---

## 4.8 Air-Gapped Release Bundles

### 4.8.1 Bundle Contents

An offline release bundle is a self-contained archive:

```
platform-release-{version}.tar
├── manifest.yaml              # Release manifest (module versions, checksums)
├── images/                    # All container images as OCI tarballs
│   ├── geoanalytics-api-2.3.0.tar
│   ├── geoanalytics-worker-2.3.0.tar
│   ├── auth-service-1.4.0.tar
│   └── ...
├── charts/                    # Helm charts
│   ├── geoanalytics-2.3.0.tgz
│   ├── auth-service-1.4.0.tgz
│   └── ...
├── migrations/                # All migration packages
│   ├── geoanalytics/
│   └── auth-service/
├── sbom/                      # SBOMs for all artifacts
├── signatures/                # Artifact signatures
├── license/                   # Entitlement bundle template
├── docs/                      # Release notes, upgrade guide
│   ├── release-notes.md
│   ├── upgrade-guide.md
│   └── known-issues.md
├── tools/                     # Installer, validator
│   ├── install.sh
│   └── verify.sh
└── checksum.sha256            # Bundle integrity check
```

### 4.8.2 Bundle Generation

Bundle generation is a release pipeline step:

1. Resolve all module versions from the release manifest.
2. Pull all container images from registry and export as OCI tarballs.
3. Package all Helm charts.
4. Package all migration packages.
5. Collect all SBOMs and signatures.
6. Generate release notes and upgrade guide.
7. Include installer and verification tooling.
8. Compute checksums for the entire bundle.
9. Sign the bundle itself.

### 4.8.3 Bundle Verification

The bundle includes a `verify.sh` script that:

- Validates the bundle checksum.
- Validates individual artifact signatures.
- Validates SBOM completeness.
- Reports any integrity failures.

This runs in the customer environment before installation, with no network connectivity required.

### 4.8.4 Upgrade Bundles

For upgrades, Build Plane can produce:

- **Full bundle** — contains everything needed for a fresh install or upgrade.
- **Delta bundle** — contains only artifacts that changed between two release versions, plus migration scripts. Smaller, faster transfer for air-gapped sites with existing installations.

Delta bundle generation requires knowing the source version. Fleet Plane provides this when requesting the bundle.

---

## 4.9 Dependency Mirroring

### 4.9.1 Internal Mirror

Build Plane operates internal mirrors for all external dependency sources:

- Container base images (distroless, Alpine, etc.)
- Language package registries (Go modules, npm, PyPI, etc.)
- System packages

### 4.9.2 Mirror Update Policy

Mirrors are updated on a controlled schedule:

- Daily automated sync for security patches.
- Weekly full sync.
- Manual sync for urgent patches.

Updates go through a validation pipeline before becoming available to builds:

1. Sync from upstream.
2. Scan for vulnerabilities.
3. Verify checksums and signatures.
4. Promote to internal mirror.

### 4.9.3 Build Isolation

Build runners have no direct internet access. All dependency resolution goes through internal mirrors. This ensures:

- Supply chain attacks via compromised upstream packages are mitigated.
- Builds are reproducible (mirror is versioned and snapshotted).
- Air-gapped bundle generation uses the same dependency sources as all other builds.

---

## 4.10 Build Metrics and Observability

### 4.10.1 Build Metrics

Build Plane tracks:

- Build duration (per pipeline type, per module)
- Build success/failure rate (per module, per pipeline type)
- Queue wait time (time from trigger to runner pickup)
- Artifact size trends
- Test execution time and flakiness rate
- Security finding trends (new findings per build, time to remediation)
- Dependency freshness (how far behind upstream)

### 4.10.2 Developer Experience Metrics

Build Plane tracks developer-facing metrics:

- Time from PR open to first CI result
- Time from merge to artifact available in registry
- Pipeline reliability (percentage of builds that fail due to infrastructure, not code)

### 4.10.3 Alerting

Build Plane alerts on:

- Pipeline infrastructure failures (runner unavailability, registry unavailability)
- Sustained build failure rate above threshold
- Critical vulnerability introduced and not blocked
- Mirror sync failures
- Registry storage approaching capacity

---

# 5. Non-Functional Requirements

## Scalability

- Support 50+ module repos concurrently
- Support 500+ builds per day across all modules
- Support 100+ concurrent pipeline executions
- Registry must store 12+ months of artifacts without performance degradation

## Performance

- Commit pipeline (lint + unit test + build): target < 10 minutes
- Merge pipeline (full): target < 20 minutes
- Release pipeline (full + bundle generation): target < 45 minutes
- PR status check visible within 30 seconds of commit push

## Reliability

- Pipeline infrastructure uptime: 99.5%
- Registry uptime: 99.9%
- Zero data loss in artifact registry (artifacts are immutable records)

## Security

- No build runner has persistent state
- No build runner has internet access
- All artifacts signed before registry push
- Signing keys rotated on schedule managed by Infrastructure Plane PKI
- Audit log of all registry pushes, pulls, and deletions

## Isolation

- Builds from different modules cannot access each other's workspaces
- Build secrets (signing keys, registry credentials) are injected per-run, not stored on runners

---

# 6. API Surface (High-Level)

Core internal services:

```
factory-build-api
  /modules                        # Module registry
  /modules/{id}/versions          # Module versions
  /modules/{id}/dependencies      # Dependency graph
  /builds                         # Build records
  /builds/{id}                    # Build detail (logs, artifacts, reports)
  /builds/{id}/artifacts          # Artifacts produced by build
  /builds/{id}/test-reports       # Test results
  /builds/{id}/security-reports   # Scan results
  /artifacts                      # Artifact registry metadata
  /artifacts/{digest}             # Artifact detail
  /artifacts/{digest}/sbom        # SBOM for artifact
  /artifacts/{digest}/signature   # Signature for artifact
  /releases                       # Release manifests
  /releases/{id}/bundle           # Offline bundle generation
  /releases/{id}/compatibility    # Compatibility matrix for release
  /sdk/versions                   # SDK version registry
  /pipelines                      # Pipeline definitions
  /pipelines/templates            # Pipeline templates
  /metrics                        # Build metrics and trends

factory-build-worker
  (internal — pipeline execution, no external API)

factory-build-registry
  (OCI-compliant registry API — standard Docker/OCI distribution spec)
```

---

# 7. Data Model (Conceptual)

```
module
module_version
module_dependency
artifact
artifact_signature
sbom
repository
branch
commit
pull_request
pr_review
ci_pipeline
ci_run
build
build_step
test_report
test_case_result
vulnerability_report
vulnerability_finding
vulnerability_exception
license_check_result
release
release_module_pin
release_bundle
sdk_version
sdk_compatibility
build_metric
```

Key relationships:

```
repository N — 1 module
module 1 — N module_version
module_version 1 — N artifact
module_version N — M module_version (dependencies)
artifact 1 — 1 artifact_signature
artifact 1 — 1 sbom
build 1 — N artifact
build 1 — N test_report
build 1 — N vulnerability_report
build N — 1 ci_run
ci_run N — 1 ci_pipeline
pull_request N — 1 repository
pull_request 1 — N ci_run
commit 1 — N ci_run
release 1 — N release_module_pin
release_module_pin N — 1 module_version
release 0 — N release_bundle
module_version N — 1 sdk_version
```

---

# 8. Integration Points

## 8.1 Product Plane → Build Plane

Product Plane defines modules and their roadmap. Build Plane receives:

- Module definitions (name, owner, product association)
- Work items linked to PRs (task → pull_request mapping)

## 8.2 Build Plane → Fleet Plane

Build Plane delivers:

- Release manifests (module version pins with artifact references)
- Offline release bundles (for air-gapped sites)
- Compatibility matrix (which module versions can coexist)

Fleet Plane consumes these to construct deployments and rollouts.

## 8.3 Build Plane → Agent Plane

Agent Plane agents interact with Build Plane:

- Code review agents read PRs, post reviews
- Code generation agents create PRs
- QA agents trigger test runs, read results
- Security agents read vulnerability reports, create exception requests

Agents authenticate via Agent Plane identity (service accounts with scoped permissions).

## 8.4 Build Plane → Infrastructure Plane

Build Plane depends on Infrastructure Plane for:

- Runner compute (Kubernetes pods or VMs for pipeline execution)
- Registry storage (persistent storage for artifacts)
- PKI (signing keys for artifact signatures)
- Network (internal mirror access, registry access)

## 8.5 Build Plane → Commerce Plane

Commerce Plane entitlements reference modules by `module_id`. Build Plane is the source of truth for module identity and versioning. Commerce Plane reads module metadata to construct entitlement options.

---

# 9. Success Criteria

- Any module can be built, tested, and published with zero custom pipeline code (using templates only).
- An engineer joining a new product team can build and test a module within their first day using the same tools and patterns.
- All artifacts in the registry are traceable to a specific commit, build, and module version.
- No unsigned artifact can enter the registry.
- No artifact with a critical unexcepted vulnerability can be promoted to a release.
- Air-gapped release bundles can be generated from any release manifest within 45 minutes.
- Air-gapped bundles install and verify successfully with zero internet connectivity.
- SDK version upgrades across all modules can be tracked and managed centrally.
- Build metrics are visible per module, per product, and platform-wide.
- Pipeline templates can be updated centrally and all module builds inherit changes on next run.

---

# 10. Explicit Boundaries

Build Plane does not:

- Decide what gets built or prioritized (Product Plane)
- Deploy artifacts to Sites (Fleet Plane)
- Manage runtime module instances (Service Plane)
- Provision build infrastructure (Infrastructure Plane provisions runners)
- Manage agent identity or execution (Agent Plane)
- Manage commercial module licensing (Commerce Plane)
- Store or manage runtime data (Data Plane)
- Define or enforce security policies at runtime (Control Plane)

Build Plane does own:

- The definition of how software is built (pipeline templates, quality gates)
- The SDK contract between platform and modules
- The artifact registry (source of truth for all deployable artifacts)
- The module version and dependency graph
- The release bundle format and generation

---

# 11. Open Questions

1. **CI engine selection.** Candidates include GitHub Actions (if using GitHub), GitLab CI (if self-hosted GitLab), Drone/Woodpecker (lightweight, container-native), or Dagger (pipeline-as-code). Decision should weigh self-hosted runner support, air-gapped operation, and developer familiarity.

2. **Registry selection.** Harbor is the leading candidate (OCI-compliant, built-in scanning, replication, RBAC). Alternatives include Zot (lightweight, OCI-native) or GitLab Container Registry (if GitLab is chosen for source control).

3. **Git hosting.** Self-hosted Gitea/GitLab (required for air-gapped Factory operation) vs. GitHub/GitLab SaaS (better developer experience, broader ecosystem). Hybrid is possible: SaaS for development, mirror to self-hosted for build execution.

4. **SDK primary language.** Go is the strongest candidate for service infrastructure. Python may be required for ML/analytics modules. Decision should be made alongside Service Plane design. The SDK contract can be language-agnostic (gRPC/HTTP), with language-specific client libraries.

5. **Signing infrastructure.** Sigstore/Cosign (keyless, modern, good ecosystem) vs. traditional GPG/key-based signing (simpler for air-gapped). May need both: Cosign for connected, key-based for air-gapped.

6. **Delta bundle strategy.** Full bundles are simpler and more reliable. Delta bundles save transfer time for large deployments. Should delta bundles be Phase 1 or Phase 2?

7. **Monorepo tooling.** If the platform monorepo grows large, build caching and affected-target detection become important. Tools like Bazel, Nx, or Turborepo may be needed. Evaluate when the monorepo exceeds ~50 packages.

8. **Contract testing framework.** Pact is the established choice. Alternatives exist. Decision should align with SDK language choice.

9. **Build provenance standard.** SLSA (Supply-chain Levels for Software Artifacts) provides a framework for build provenance. Target SLSA Level 2 in Phase 1, Level 3 in Phase 2. Confirm this aligns with customer compliance requirements.

10. **Multi-product artifact isolation.** Should artifacts for different products (Trafficure, NetworkAccess, SmartMarket) be stored in separate registry projects/namespaces, or in a shared registry with product labels? Affects access control and replication configuration.

---

# 12. Phased Delivery

## Phase 1 — Foundation

- Platform monorepo established with SDK (v1), shared libraries, pipeline templates
- Module repo template (cookiecutter/scaffold) producing standard layout
- CI pipeline templates for commit, merge, and release
- Self-hosted runners on Proxmox
- Self-hosted artifact registry (container images, Helm charts)
- Artifact signing (basic key-based)
- Dependency scanning and SAST in pipelines
- SBOM generation on release builds
- Quality gates (test coverage, security scan pass)
- Build metrics dashboard
- Release manifest format defined
- First modules (SmartMarket) building through the system

## Phase 2 — Scale

- SDK v2 with richer patterns (event system, background jobs, config schema)
- Multi-language SDK support (if required by module needs)
- Contract testing in pipelines
- Performance testing in pipelines
- Nightly pipeline with regression detection
- Dependency mirroring infrastructure
- Air-gapped release bundle generation
- Delta bundle support
- Advanced build metrics (flaky test detection, dependency freshness)
- Registry replication for regional distribution
- Signed commits enforcement
- SLSA Level 2 provenance

## Phase 3 — Enterprise Maturity

- SLSA Level 3 provenance
- Hermetic builds (fully reproducible, no network during build)
- Build attestation chains (full provenance from source to deployed artifact)
- Module marketplace support (third-party module builds with additional security gates)
- Advanced compatibility matrix (automated integration test matrix across module versions)
- Build cost attribution (per team, per product)
- Registry federation across multiple registries

---

# Final Definition

The Build Plane is the authoritative company-wide system for software construction.

It standardizes:

- How code is structured (repository layout, module metadata)
- How code is reviewed (branch policies, PR workflows)
- How code is built (pipeline templates, quality gates)
- How code is tested (test tiers, tenant isolation verification)
- How code is secured (scanning, SBOM, license compliance)
- How code is packaged (artifacts, signing, registry)
- How code is released (release manifests, offline bundles)
- How modules integrate with the platform (SDK contract)

Across all products. The product is a dimension, not a different system.

Build Plane produces artifacts. Fleet Plane deploys them. Service Plane runs them. Build Plane's job is done when a signed, scanned, tested artifact is in the registry and a release manifest is ready for Fleet to consume.
