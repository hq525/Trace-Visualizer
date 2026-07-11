// Best-effort tsconfig.json#compilerOptions.paths loader (plan.md §5.4).
// tsconfig is JSONC: comments and trailing commas are legal. We try strict
// JSON first, then a crude comment/trailing-comma strip. Anything unparseable
// silently yields no aliases — this feature must never break a run.
import fs from "node:fs";
import path from "node:path";

export type PathAliases = Record<string, string[]>;

export function loadTsconfigPaths(root: string): PathAliases {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(root, "tsconfig.json"), "utf8");
  } catch {
    return {};
  }
  const parsed = parseJsonc(raw);
  if (!parsed || typeof parsed !== "object") return {};
  const compilerOptions = (parsed as { compilerOptions?: unknown }).compilerOptions;
  if (!compilerOptions || typeof compilerOptions !== "object") return {};
  const paths = (compilerOptions as { paths?: unknown }).paths;
  if (!paths || typeof paths !== "object") return {};
  const aliases: PathAliases = {};
  for (const [pattern, targets] of Object.entries(paths as Record<string, unknown>)) {
    if (Array.isArray(targets) && targets.every((t) => typeof t === "string")) {
      aliases[pattern] = targets as string[];
    }
  }
  return aliases;
}

function parseJsonc(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // strip /* */ and // comments (naive: fine outside string values in
    // tsconfig-shaped files) and trailing commas, then retry
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,(\s*[}\]])/g, "$1");
    try {
      return JSON.parse(stripped);
    } catch {
      return null;
    }
  }
}

/** "@app/fx" with {"@app/*": ["src/*"]} → ["@app/fx", "src/fx"] */
export function expandAliases(module: string, aliases: PathAliases): string[] {
  const out = [module];
  for (const [pattern, targets] of Object.entries(aliases)) {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1); // keep the trailing slash
      if (module.startsWith(prefix)) {
        const rest = module.slice(prefix.length);
        for (const t of targets) out.push(t.replace("*", rest));
      }
    } else if (module === pattern) {
      out.push(...targets);
    }
  }
  return out;
}
