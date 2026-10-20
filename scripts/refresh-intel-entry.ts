import { writeSnapshots } from "../server/snapshot";

export async function refreshIntel(outDir: string, budgetMs: number) {
  return writeSnapshots(outDir, budgetMs);
}
