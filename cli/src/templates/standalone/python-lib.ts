import type { TemplateVars, GeneratedFile } from "../types.js";
import { pythonQualityToml, pythonQualityFiles } from "../quality-configs.js";

/** Converts a hyphenated name to a Python module name (e.g. "my-lib" -> "my_lib") */
export function toPythonModule(name: string): string {
  return name.replace(/-/g, "_");
}

export function generate(vars: TemplateVars): GeneratedFile[] {
  const { name, description } = vars;
  const pythonName = toPythonModule(name);

  const files: GeneratedFile[] = [];

  // pyproject.toml
  files.push({
    path: "pyproject.toml",
    content: `[project]
name = "${name}"
version = "0.1.0"
description = "${description}"
readme = "README.md"
requires-python = ">=3.11"
dependencies = []

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/${pythonName}"]
${pythonQualityToml()}`,
  });

  // src/{pythonName}/__init__.py
  files.push({
    path: `src/${pythonName}/__init__.py`,
    content: `"""${description}"""\n`,
  });

  // tests/__init__.py
  files.push({
    path: "tests/__init__.py",
    content: ``,
  });

  // tests/test_{pythonName}.py
  files.push({
    path: `tests/test_${pythonName}.py`,
    content: `def test_placeholder():
    """Placeholder test — replace with real tests."""
    assert True
`,
  });

  // .gitignore
  files.push({
    path: ".gitignore",
    content: `__pycache__/
.venv/
dist/
*.egg-info/
.ruff_cache/
`,
  });

  // Quality tooling configs
  files.push(...pythonQualityFiles());

  return files;
}
