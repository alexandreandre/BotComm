import { buildApp } from "./app";
import { env } from "./config/env";

async function start(): Promise<void> {
  const app = buildApp();
  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info({ port: env.PORT, env: env.NODE_ENV }, "cinecontent-bot-dispatcher started");
  } catch (error) {
    app.log.error({ err: error }, "Failed to start server");
    process.exit(1);
  }
}

void start();
