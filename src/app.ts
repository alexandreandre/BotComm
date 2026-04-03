import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import Fastify from "fastify";
import path from "node:path";
import { registerCinecontentRoutes } from "./api/register-routes";
import { env } from "./config/env";
import { logger } from "./core/logger";
import { GameAdapterRegistry } from "./games/registry";
import { DispatchController } from "./http/controllers/dispatch.controller";
import { registerErrorHandler } from "./http/middleware/error-handler";
import { registerDispatchRoute } from "./http/routes/dispatch.route";
import { registerHealthRoute } from "./http/routes/health.route";
import { DispatchRunService } from "./services/dispatch-run.service";
import { RunBotService } from "./services/run-bot.service";
import { ScreenshotService } from "./services/screenshot.service";
import { StorageService } from "./services/storage.service";
import { VideoService } from "./services/video.service";
import { WebhookService } from "./services/webhook.service";

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: env.BODY_LIMIT_BYTES
  });

  await app.register(cors, { origin: true });

  const registry = new GameAdapterRegistry();
  const screenshotService = new ScreenshotService();
  const videoService = new VideoService();
  const storageService = new StorageService();
  const webhookService = new WebhookService();
  const runBotService = new RunBotService(
    registry,
    screenshotService,
    videoService,
    storageService,
    webhookService
  );
  const dispatchRunService = new DispatchRunService(runBotService);
  const dispatchController = new DispatchController(dispatchRunService);

  registerErrorHandler(app);
  void registerHealthRoute(app);
  void registerDispatchRoute(app, dispatchController);
  await registerCinecontentRoutes(
    app as unknown as import("fastify").FastifyInstance,
    {
      dispatchRunService,
      storageService
    }
  );

  if (env.FRONTEND_DIST_PATH) {
    const root = path.resolve(env.FRONTEND_DIST_PATH);
    await app.register(staticFiles, {
      root,
      prefix: "/",
      decorateReply: false
    });
    app.setNotFoundHandler((request, reply) => {
      const url = request.raw.url?.split("?")[0] ?? "";
      if (url.startsWith("/api") || url.startsWith("/dispatch") || url.startsWith("/healthz")) {
        void reply.status(404).send({ ok: false, error: "Not found" });
        return;
      }
      void reply.sendFile("index.html");
    });
  }

  return app;
}
