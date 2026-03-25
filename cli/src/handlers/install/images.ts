import { readdirSync } from "node:fs";
import { join } from "node:path";
import { runOrThrow } from "../../lib/subprocess.js";
import type { InstallRole, BundleManifest } from "@smp/factory-shared/install-types";
import { K3S_KUBECONFIG } from "./k3s.js";

export interface ImageLoadOptions {
  role: InstallRole;
  bundlePath?: string;
  bundleManifest?: BundleManifest;
  registryUrl?: string;
  verbose?: boolean;
}

/** Phase 3: Load OCI images into containerd (offline) or pull from registry (connected). */
export function loadImages(opts: ImageLoadOptions): void {
  if (opts.bundlePath) {
    loadImagesOffline(opts);
  } else {
    pullImagesConnected(opts);
  }
}

function loadImagesOffline(opts: ImageLoadOptions): void {
  const imageDir = join(opts.bundlePath!, "images");
  const subdirs = opts.role === "factory" ? ["site", "factory"] : ["site"];

  let loaded = 0;
  for (const sub of subdirs) {
    const dir = join(imageDir, sub);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".tar"));
    } catch {
      if (sub === "factory" && opts.role === "site") continue;
      throw new Error(`Image directory not found: ${dir}`);
    }

    for (const file of files) {
      const tarPath = join(dir, file);
      console.log(`Loading image: ${file}`);
      runOrThrow("ctr", ["-n", "k8s.io", "images", "import", tarPath], {
        verbose: opts.verbose,
      });
      loaded++;
    }
  }

  console.log(`Loaded ${loaded} images into containerd.`);
}

function pullImagesConnected(opts: ImageLoadOptions): void {
  if (!opts.bundleManifest) {
    throw new Error("Bundle manifest required for connected image pull");
  }

  const images = opts.bundleManifest.images.filter((img) => {
    // In site mode, skip factory-only images
    if (opts.role === "site") {
      const factoryOnly = ["dx-builder", "fleet-plane", "commerce-plane", "product-plane"];
      return !factoryOnly.some((prefix) => img.name.startsWith(prefix));
    }
    return true;
  });

  const registry = opts.registryUrl ?? "registry.dx.dev";

  for (const img of images) {
    const ref = `${registry}/${img.name}:${img.tag}`;
    console.log(`Pulling image: ${ref}`);
    runOrThrow("ctr", ["-n", "k8s.io", "images", "pull", ref], {
      verbose: opts.verbose,
    });
  }

  console.log(`Pulled ${images.length} images.`);
}
