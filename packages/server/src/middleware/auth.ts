import type { Request, Response, NextFunction } from "express";
import type { SessionService, ValidatedSession } from "../services/session-service.js";

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        email: string;
        role: "admin" | "operator";
        displayName: string | null;
      };
      sessionId?: string;
    }
  }
}

function extractToken(req: Request): string | null {
  // Check Authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Fall back to cookie
  const cookie = req.cookies?.infrawatch_session;
  if (cookie) {
    return cookie;
  }

  return null;
}

export function createRequireAuth(sessionService: SessionService) {
  return async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const token = extractToken(req);

    if (!token) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const session = await sessionService.validateSession(token);
    if (!session) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    req.user = {
      id: session.userId,
      username: session.username,
      email: session.email,
      role: session.role,
      displayName: session.displayName,
    };
    req.sessionId = session.sessionId;

    next();
  };
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
