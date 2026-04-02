import { env } from "../config/env";
import { logger } from "../core/logger";
import { CallbackPayload } from "../domain/types";
import { retry } from "../utils/retry";

export class WebhookService {
  async sendCallback(webhookUrl: string, payload: CallbackPayload): Promise<void> {
    await retry(
      async (attempt) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), env.WEBHOOK_TIMEOUT_MS);

        try {
          const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal
          });

          if (!response.ok) {
            const responseText = await response.text().catch(() => "");
            throw new Error(`Webhook HTTP ${response.status}: ${responseText}`);
          }

          logger.info({ run_id: payload.run_id, attempt }, "Webhook callback sent");
        } finally {
          clearTimeout(timeout);
        }
      },
      {
        attempts: Math.max(1, env.WEBHOOK_MAX_RETRIES),
        baseDelayMs: 500,
        maxDelayMs: 5000
      }
    );
  }
}
