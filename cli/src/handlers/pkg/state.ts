/**
 * Package state management — reads/writes .dx/packages.json.
 *
 * Format is backwards-compatible with the Python dx-cli PackageManager.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface PackageEntry {
  source: string;
  source_path?: string;
  type: "npm" | "java" | "python";
  local_path: string;
  branch: string;
  checkout_branch: string;
  repo_path?: string;
  checked_out_at?: string;
  contributed_at?: string;
  mode: "link" | "contribute";
}

export class PackageState {
  private filePath: string;

  constructor(root: string) {
    this.filePath = join(root, ".dx", "packages.json");
  }

  read(): Record<string, PackageEntry> {
    try {
      const text = readFileSync(this.filePath, "utf8");
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  private write(data: Record<string, PackageEntry>): void {
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2) + "\n");
  }

  add(name: string, entry: PackageEntry): void {
    const data = this.read();
    data[name] = entry;
    this.write(data);
  }

  remove(name: string): void {
    const data = this.read();
    delete data[name];
    this.write(data);
  }

  get(name: string): PackageEntry | undefined {
    return this.read()[name];
  }

  all(): Record<string, PackageEntry> {
    return this.read();
  }
}
