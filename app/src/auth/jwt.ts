import jwt from "jsonwebtoken";
import type { UserRole } from "../domain/user.js";

export type AccessPayload = {
  sub: string;
  username: string;
  role: UserRole;
};

export type RefreshPayload = {
  sub: string;
  jti: string;
};

export type JwtConfig = {
  secret: string;
  accessTtlSec: number;
  refreshTtlSec: number;
};

export class TokenInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenInvalidError";
  }
}

export class JwtService {
  constructor(private readonly cfg: JwtConfig) {}

  signAccess(payload: AccessPayload): string {
    return jwt.sign(payload, this.cfg.secret, {
      expiresIn: this.cfg.accessTtlSec,
    });
  }

  signRefresh(payload: RefreshPayload): string {
    return jwt.sign(payload, this.cfg.secret, {
      expiresIn: this.cfg.refreshTtlSec,
    });
  }

  verifyAccess(token: string): AccessPayload {
    try {
      const decoded = jwt.verify(token, this.cfg.secret) as AccessPayload & {
        jti?: string;
      };
      if (typeof decoded !== "object" || decoded === null) {
        throw new TokenInvalidError("invalid access token");
      }
      if ("jti" in decoded && decoded.jti) {
        throw new TokenInvalidError("expected access token, got refresh");
      }
      return {
        sub: String(decoded.sub),
        username: String(decoded.username),
        role: decoded.role,
      };
    } catch (err) {
      if (err instanceof TokenInvalidError) throw err;
      throw new TokenInvalidError(
        err instanceof Error ? err.message : "invalid access token",
      );
    }
  }

  verifyRefresh(token: string): RefreshPayload {
    try {
      const decoded = jwt.verify(token, this.cfg.secret) as RefreshPayload;
      if (
        typeof decoded !== "object" ||
        decoded === null ||
        !decoded.jti ||
        !decoded.sub
      ) {
        throw new TokenInvalidError("invalid refresh token");
      }
      return { sub: String(decoded.sub), jti: String(decoded.jti) };
    } catch (err) {
      if (err instanceof TokenInvalidError) throw err;
      throw new TokenInvalidError(
        err instanceof Error ? err.message : "invalid refresh token",
      );
    }
  }

  get refreshTtlSec(): number {
    return this.cfg.refreshTtlSec;
  }

  get accessTtlSec(): number {
    return this.cfg.accessTtlSec;
  }
}
