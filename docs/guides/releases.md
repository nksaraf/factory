# Releases

A release is a tagged, reproducible version of a system and its artifacts.

## Creating a Release

```bash
dx release create 1.0.0           # Tag a release
dx release create 1.1.0 --notes "Added search feature"
```

## Listing Releases

```bash
dx release list                    # Show all releases
dx release status <id>             # Check a specific release
```

## Release → Deploy

```bash
dx deploy create <release-id> --target <target-id>
```

## Versioning

Releases use semantic versioning: `major.minor.patch`

- **major** — Breaking changes
- **minor** — New features, backwards compatible
- **patch** — Bug fixes

## For Air-Gapped Sites

Release bundles package all container images for distribution to sites without internet access:

```bash
dx release bundle <release-id> --arch amd64
```

## Related

- [Deploying](/guides/deploying)
- [Previews](/guides/previews)
- [build domain](/concepts/build)
