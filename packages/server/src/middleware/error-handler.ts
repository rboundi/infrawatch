import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";

export function createErrorHandler(logger: Logger) {
  return (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, "Unhandled error");

    const status = (err as unknown as Record<string, unknown>).status as number | undefined;

    res.status(status ?? 500).json({
      error: err.message || "Internal server error",
    });
  };
}
