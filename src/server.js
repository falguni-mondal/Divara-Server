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

  const shutdown = async (signal) => {
    console.log(`\n[DIVARA Server] Received ${signal}. Shutting down cleanly...`);
    reclaimerTask.stop();
    jobWorker.stop();
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap();