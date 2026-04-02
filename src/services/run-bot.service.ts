import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Browser, BrowserContext, Page, chromium } from "playwright";
import { env } from "../config/env";
import { AppError, toErrorMessage } from "../core/errors";
import { logger } from "../core/logger";
import { DispatchPayload, RunEvent } from "../domain/types";
import { GameAdapterRegistry } from "../games/registry";
import { safeRunContext } from "../utils/sanitize";
import { durationSeconds } from "../utils/time";
import { ScreenshotService } from "./screenshot.service";
import { StorageService } from "./storage.service";
import { VideoService } from "./video.service";
import { WebhookService } from "./webhook.service";

function timeoutPromise<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new AppError(message, { code: "RUN_TIMEOUT" })), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timeout));
  });
}

export class RunBotService {
  constructor(
    private readonly registry: GameAdapterRegistry,
    private readonly screenshotService: ScreenshotService,
    private readonly videoService: VideoService,
    private readonly storageService: StorageService,
    private readonly webhookService: WebhookService
  ) {}

  async execute(payload: DispatchPayload): Promise<void> {
    const startedAt = Date.now();
    const workDir = path.join(tmpdir(), `cinecontent-bot-${payload.run_id}`);
    const videoDir = path.join(workDir, "videos");
    const screenshotDir = path.join(workDir, "screenshots");

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    const events: RunEvent[] = [];
    const screenshotLocalPaths: string[] = [];

    try {
      logger.info({ payload: safeRunContext(payload) }, "Run starting");
      await mkdir(videoDir, { recursive: true });
      await mkdir(screenshotDir, { recursive: true });

      browser = await chromium.launch({
        headless: env.PLAYWRIGHT_HEADLESS,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      });
      logger.info({ run_id: payload.run_id }, "Browser launched");

      context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        recordVideo: {
          dir: videoDir,
          size: { width: 1280, height: 720 }
        }
      });
      page = await context.newPage();
      page.setDefaultNavigationTimeout(env.PLAYWRIGHT_NAV_TIMEOUT_MS);
      page.setDefaultTimeout(env.PLAYWRIGHT_NAV_TIMEOUT_MS);

      const adapter = this.registry.resolve(payload.game);
      logger.info({ run_id: payload.run_id, game: adapter.name }, "Game adapter selected");

      await page.goto(payload.game_url, {
        waitUntil: "domcontentloaded",
        timeout: env.PLAYWRIGHT_NAV_TIMEOUT_MS
      });
      logger.info({ run_id: payload.run_id }, "Game page loaded");

      const startShot = await this.screenshotService.capture(page, screenshotDir, "screenshot_1.png");
      screenshotLocalPaths.push(startShot);

      await adapter.init(page);
      await adapter.start();
      logger.info({ run_id: payload.run_id }, "Game started");

      const maxRunMs = Math.min(payload.max_duration_seconds * 1000, env.MAX_RUN_TIMEOUT_MS);
      const gameRunResult = await timeoutPromise(
        adapter.play({
          runId: payload.run_id,
          botGoal: payload.bot_goal,
          maxDurationMs: maxRunMs
        }),
        maxRunMs + 5000,
        `Timeout: run exceeded ${Math.round((maxRunMs + 5000) / 1000)}s`
      );

      events.push(...gameRunResult.events);
      screenshotLocalPaths.push(...gameRunResult.screenshotPaths);

      const endShot = await this.screenshotService.capture(page, screenshotDir, "screenshot_2.png");
      screenshotLocalPaths.push(endShot);

      const score = gameRunResult.score;
      if (score === null) {
        throw new AppError("Score non lisible", { code: "SCORE_UNREADABLE" });
      }
      const streak = gameRunResult.streak ?? 0;

      await context.close();
      context = null;

      const videoLocalPath = await this.videoService.resolveVideoPath(page);
      logger.info({ run_id: payload.run_id }, "Video captured");

      const uploaded = await this.storageService.uploadRunArtifacts({
        bucket: payload.storage_bucket,
        storagePath: payload.storage_path,
        videoLocalPath,
        screenshotLocalPaths
      });
      logger.info({ run_id: payload.run_id, video_path: uploaded.video_path }, "Artifacts uploaded");

      await this.webhookService.sendCallback(payload.webhook_url, {
        run_id: payload.run_id,
        callback_token: payload.callback_token,
        status: "completed",
        score,
        streak,
        duration: durationSeconds(startedAt),
        video_path: uploaded.video_path,
        screenshots: uploaded.screenshots,
        events,
        error_message: null
      });

      logger.info({ run_id: payload.run_id }, "Run completed");
    } catch (error) {
      const message = toErrorMessage(error);
      logger.error({ run_id: payload.run_id, err: error }, "Run failed");

      try {
        await this.webhookService.sendCallback(payload.webhook_url, {
          run_id: payload.run_id,
          callback_token: payload.callback_token,
          status: "failed",
          error_message: message
        });
      } catch (callbackError) {
        logger.error(
          { run_id: payload.run_id, err: callbackError },
          "Failed to send webhook failure callback"
        );
      }
    } finally {
      await Promise.allSettled([context?.close(), browser?.close()]);
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
