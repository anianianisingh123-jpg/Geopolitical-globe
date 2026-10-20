/**
 * Warm the intel service and write static JSON snapshots for GitHub Pages.
 *
 * Usage: node scripts/refresh-intel.mjs [outDir] [budgetMs]
 * Default outDir: public/api/intel
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(process.argv[2] ?? join(root, "public/api/intel"));
const budgetMs = Number(process.argv[3] ?? 8 * 60_000);

// Use Vite's bundled esbuild to compile the TS intel entry for Node.
const require = createRequire(import.meta.url);
const esbuild = (() => {
  try {
    return require("esbuild");
  } catch {
    try {
      return require("vite/node_modules/esbuild");
    } catch {
      return null;
    }
  }
})();

async function main() {
  if (!esbuild) {
    console.error("esbuild missing — run npm ci first");
    process.exit(1);
  }
  const outfile = join(root, "node_modules/.cache/signal-heat-intel-snap.mjs");
  mkdirSync(dirname(outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [join(root, "scripts/refresh-intel-entry.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile,
    packages: "bundle",
    logLevel: "warning",
  });

  const mod = await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
  const stats = await mod.refreshIntel(outDir, budgetMs);
  console.log(`intel snapshot → ${outDir}`);
  console.log(JSON.stringify(stats, null, 2));
  writeFileSync(join(outDir, "meta.json"), JSON.stringify({ ...stats, at: Date.now() }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
