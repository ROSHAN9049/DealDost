import "./runtime-hardening.js";
import { BinanceScanner } from "./scanner.js";
import { createApp } from "./server.js";

const scanner = new BinanceScanner();
createApp(scanner);

scanner.start().catch((error) => {
  console.error("[startup] Scanner failed to start:", error);
  process.exitCode = 1;
});

const shutdown = async (signal: string) => {
  console.log("[shutdown] " + signal);
  await scanner.stop();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
