import { env } from "../config/env";
import { AppError } from "../core/errors";
import { logger } from "../core/logger";
import { DispatchPayload, DispatchAcceptedResponse } from "../domain/types";
import { RunBotService } from "./run-bot.service";

export class DispatchRunService {
  private activeRuns = 0;

  constructor(private readonly runBotService: RunBotService) {}

  dispatch(payload: DispatchPayload): DispatchAcceptedResponse {
    if (this.activeRuns >= env.RUN_CONCURRENCY_LIMIT) {
      throw new AppError("Run concurrency limit reached", { code: "RUN_LIMIT", statusCode: 429 });
    }

    this.activeRuns += 1;
    logger.info({ run_id: payload.run_id, active_runs: this.activeRuns }, "Run accepted");

    void this.runBotService
      .execute(payload)
      .catch((error) => {
        logger.error({ run_id: payload.run_id, err: error }, "Unhandled run execution error");
      })
      .finally(() => {
        this.activeRuns -= 1;
        logger.info({ run_id: payload.run_id, active_runs: this.activeRuns }, "Run settled");
      });

    return {
      ok: true,
      run_id: payload.run_id,
      status: "accepted"
    };
  }
}
