export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly retriable: boolean;

  constructor(message: string, options?: { code?: string; statusCode?: number; retriable?: boolean }) {
    super(message);
    this.name = "AppError";
    this.code = options?.code ?? "APP_ERROR";
    this.statusCode = options?.statusCode ?? 500;
    this.retriable = options?.retriable ?? false;
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}
