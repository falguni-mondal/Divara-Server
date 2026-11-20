import { env } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./config/db.js";
import { createApp } from "./app.js";
import { startReservationReclaimer } from "./workers/reservationReclaimer.js";
import { startJobWorker } from "./workers/jobWorker.js";

async function bootstrap() {
  await connectDatabase();

  const app = createApp();
  const reclaimerTask = startReservationReclaimer();
  const jobWorker = startJobWorker(5000);

  const server = app.listen(env.PORT, () => {
    console.log(`[DIVARA Server] Listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  let isShuttingDown = false;

  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n[DIVARA Server] Received ${signal}. Shutting down cleanly...`);
    reclaimerTask.stop();
    jobWorker.stop();

    const forceTimer = setTimeout(() => {
      console.error("[DIVARA Server] Forced exit after 10s shutdown timeout.");
      process.exit(1);
    }, 10000);
    forceTimer.unref();

    server.close(async () => {
      try {
        await disconnectDatabase();
        clearTimeout(forceTimer);
        process.exit(0);
      } catch (err) {
        console.error("[DIVARA Server] Error during database disconnect:", err);
        process.exit(1);
      }
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    console.error("[DIVARA Server] Unhandled Promise Rejection:", reason);
  });
}

bootstrap().catch((err) => {
  console.error("[DIVARA Server] Fatal bootstrap error:", err);
  process.exit(1);
});