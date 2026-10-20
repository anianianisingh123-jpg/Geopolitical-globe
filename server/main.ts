/**
 * Standalone intel HTTP server for production hosts (Fly, Render, Railway, …).
 *
 *   PORT=8787 node --import tsx server/main.ts
 *   npm run intel
 */
import { createServer } from "node:http";
import { IntelService } from "./intel";

const port = Number(process.env.PORT ?? 8787);
const service = new IntelService();
const server = createServer((req, res) => {
  service.handle(req, res).catch((e: unknown) => {
    res.statusCode = 500;
    res.end(e instanceof Error ? e.message : "intel error");
  });
});

server.listen(port, () => {
  console.log(`signal-heat intel on :${port}`);
});

const shutdown = () => {
  service.dispose();
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
