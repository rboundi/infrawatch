import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";

export function createErrorHandler(logger: Logger) {
  return (err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status ?? 500;

    logger.error(
      {
        err,
        status,
        stack: err.stack,
      },
      "Unhandled error in request"
    );

    if (res.headersSent) {
      return;
    }

    res.status(status).json({
      error: status >= 500 ? "Internal server error" : err.message,
    });
  };
}
