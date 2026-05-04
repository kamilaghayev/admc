import { Router, type Request, type Response } from "express";
import { AuthError, type AuthService } from "../auth/auth.service.js";
import type { JwtService } from "../auth/jwt.js";
import { requireAuth } from "../auth/middleware.js";

type LoginBody = { username?: unknown; password?: unknown };
type RefreshBody = { refreshToken?: unknown };

function parseLogin(body: unknown): { username: string; password: string } | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be an object" };
  }
  const b = body as LoginBody;
  if (typeof b.username !== "string" || b.username.trim() === "") {
    return { error: "username is required" };
  }
  if (typeof b.password !== "string" || b.password === "") {
    return { error: "password is required" };
  }
  return { username: b.username, password: b.password };
}

function parseRefresh(body: unknown): { refreshToken: string } | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be an object" };
  }
  const b = body as RefreshBody;
  if (typeof b.refreshToken !== "string" || b.refreshToken === "") {
    return { error: "refreshToken is required" };
  }
  return { refreshToken: b.refreshToken };
}

export type AuthDeps = {
  authService: AuthService;
  jwt: JwtService;
};

export function buildAuthRouter(deps: AuthDeps): Router {
  const router = Router();
  const { authService, jwt } = deps;

  router.post("/login", async (req: Request, res: Response) => {
    const parsed = parseLogin(req.body);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      const result = await authService.login(parsed);
      res.json(result);
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/refresh", async (req: Request, res: Response) => {
    const parsed = parseRefresh(req.body);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      const result = await authService.refresh(parsed.refreshToken);
      res.json(result);
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.post("/logout", async (req: Request, res: Response) => {
    const parsed = parseRefresh(req.body);
    if ("error" in parsed) {
      res.status(204).end();
      return;
    }
    await authService.logout(parsed.refreshToken);
    res.status(204).end();
  });

  router.get("/me", requireAuth(jwt), async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const me = await authService.me(user.id);
    if (!me) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    res.json(me);
  });

  return router;
}

export const openApiTags = [
  { name: "Auth", description: "Login, refresh, logout, me" },
];

export const openApiSchemas = {
  LoginInput: {
    type: "object",
    required: ["username", "password"],
    properties: {
      username: { type: "string" },
      password: { type: "string" },
    },
  },
  RefreshInput: {
    type: "object",
    required: ["refreshToken"],
    properties: {
      refreshToken: { type: "string" },
    },
  },
  TokenPair: {
    type: "object",
    properties: {
      accessToken: { type: "string" },
      refreshToken: { type: "string" },
      expiresIn: { type: "integer" },
      refreshExpiresIn: { type: "integer" },
    },
  },
  PublicUser: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      username: { type: "string" },
      role: { type: "string", enum: ["admin", "user"] },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  LoginResult: {
    type: "object",
    properties: {
      user: { $ref: "#/components/schemas/PublicUser" },
      tokens: { $ref: "#/components/schemas/TokenPair" },
    },
  },
};

export const openApiPaths = {
  "/api/auth/login": {
    post: {
      tags: ["Auth"],
      summary: "Login (username/parol)",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/LoginInput" },
          },
        },
      },
      responses: {
        "200": {
          description: "OK",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoginResult" },
            },
          },
        },
        "401": { description: "Invalid credentials" },
      },
    },
  },
  "/api/auth/refresh": {
    post: {
      tags: ["Auth"],
      summary: "Refresh token (rotation)",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RefreshInput" },
          },
        },
      },
      responses: {
        "200": {
          description: "OK",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoginResult" },
            },
          },
        },
        "401": { description: "Invalid / reused refresh" },
      },
    },
  },
  "/api/auth/logout": {
    post: {
      tags: ["Auth"],
      summary: "Logout (refresh token revoke)",
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RefreshInput" },
          },
        },
      },
      responses: { "204": { description: "OK" } },
    },
  },
  "/api/auth/me": {
    get: {
      tags: ["Auth"],
      summary: "Current user profile",
      responses: {
        "200": {
          description: "Current user",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PublicUser" },
            },
          },
        },
        "401": { description: "Unauthenticated" },
      },
    },
  },
};
