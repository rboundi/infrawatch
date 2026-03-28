import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  if (!config.apiKey) {
    return next();
  }

  const provided = req.header("X-API-Key");

  if (!provided || provided !== config.apiKey) {
    res.status(401).json({ error: "Invalid or missing API key" });
    return;
  }

  next();
}
