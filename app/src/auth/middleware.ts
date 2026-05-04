import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { UserRole } from "../domain/user.js";
import { JwtService, TokenInvalidError } from "./jwt.js";

export type AuthedUser = {
  id: string;
  username: string;
  role: UserRole;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export function requireAuth(jwt: JwtService): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization");
    if (!header) {
      res.status(401).json({ error: "missing Authorization header" });
      return;
    }
    const [scheme, token] = header.split(" ");
    if ((scheme ?? "").toLowerCase() !== "bearer" || !token) {
      res.status(401).json({ error: "expected: Bearer <token>" });
      return;
    }
    try {
      const payload = jwt.verifyAccess(token);
      req.user = {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
      };
      next();
    } catch (err) {
      const message =
        err instanceof TokenInvalidError ? err.message : "invalid token";
      res.status(401).json({ error: message });
    }
  };
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "insufficient role" });
      return;
    }
    next();
  };
}
