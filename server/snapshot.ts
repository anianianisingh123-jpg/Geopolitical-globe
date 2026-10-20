import { IntelService } from "./intel";

/** Warm feeds and write news / trends / fires / events JSON for static hosting. */
export async function writeSnapshots(outDir: string, budgetMs = 8 * 60_000) {
  const service = new IntelService();
  try {
    return await service.writeSnapshots(outDir, budgetMs);
  } finally {
    service.dispose();
  }
}
