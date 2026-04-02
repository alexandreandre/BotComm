import Fastify from "fastify";
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

export function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: env.BODY_LIMIT_BYTES
  });

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

  return app;
}
