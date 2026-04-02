import { ZodError } from "zod";
import { AppError } from "../../core/errors";

export function registerErrorHandler(app: any): void {
  app.setErrorHandler((error: any, _request: any, reply: any) => {
    if (error instanceof ZodError) {
      reply.status(400).send({
        ok: false,
        error: "Invalid payload",
        details: error.flatten()
      });
      return;
    }

    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        ok: false,
        error: error.message,
        code: error.code
      });
      return;
    }

    app.log.error({ err: error }, "Unhandled HTTP error");
    reply.status(500).send({
      ok: false,
      error: "Internal server error"
    });
  });
}
