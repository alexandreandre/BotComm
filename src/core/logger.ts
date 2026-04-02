import pino, { LoggerOptions } from "pino";
import { env } from "../config/env";

const loggerOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "payload.callback_token",
      "callback_token",
      "SUPABASE_SERVICE_ROLE_KEY"
    ],
    censor: "[REDACTED]"
  }
};

if (env.NODE_ENV === "development") {
  loggerOptions.transport = {
    target: "pino-pretty",
    options: {
      colorize: true
    }
  };
}

export const logger = pino(loggerOptions);
