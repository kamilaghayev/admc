import { randomUUID } from "node:crypto";
import type { LoginInput, PublicUser } from "../domain/user.js";
import { toPublicUser } from "../domain/user.js";
import type { UserService } from "../services/user.service.js";
import { JwtService, TokenInvalidError } from "./jwt.js";
import type { RefreshTokenStore } from "./refresh-store.js";

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
};

export type LoginResult = {
  user: PublicUser;
  tokens: TokenPair;
};

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class AuthService {
  constructor(
    private readonly users: UserService,
    private readonly jwt: JwtService,
    private readonly refreshStore: RefreshTokenStore,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const user = await this.users.findByUsername(input.username);
    if (!user) {
      throw new AuthError("invalid credentials", 401);
    }
    const ok = await this.users.verifyPassword(user, input.password);
    if (!ok) {
      throw new AuthError("invalid credentials", 401);
    }
    const tokens = await this.issueTokens(user.id, user.username, user.role);
    return { user: toPublicUser(user), tokens };
  }

  async refresh(refreshToken: string): Promise<LoginResult> {
    let payload;
    try {
      payload = this.jwt.verifyRefresh(refreshToken);
    } catch (err) {
      if (err instanceof TokenInvalidError) {
        throw new AuthError(err.message, 401);
      }
      throw err;
    }
    const userId = await this.refreshStore.consume(payload.jti);
    if (!userId || userId !== payload.sub) {
      throw new AuthError("refresh token reuse / not found", 401);
    }
    const user = await this.users.findById(userId);
    if (!user) {
      throw new AuthError("user not found", 401);
    }
    const tokens = await this.issueTokens(user.id, user.username, user.role);
    return { user: toPublicUser(user), tokens };
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      const { jti } = this.jwt.verifyRefresh(refreshToken);
      await this.refreshStore.revoke(jti);
    } catch {
      // ignore: stale/invalid refresh token logout is a no-op
    }
  }

  async me(userId: string): Promise<PublicUser | null> {
    const user = await this.users.findById(userId);
    return user ? toPublicUser(user) : null;
  }

  private async issueTokens(
    userId: string,
    username: string,
    role: PublicUser["role"],
  ): Promise<TokenPair> {
    const jti = randomUUID();
    const accessToken = this.jwt.signAccess({
      sub: userId,
      username,
      role,
    });
    const refreshToken = this.jwt.signRefresh({ sub: userId, jti });
    await this.refreshStore.save(jti, userId);
    return {
      accessToken,
      refreshToken,
      expiresIn: this.jwt.accessTtlSec,
      refreshExpiresIn: this.jwt.refreshTtlSec,
    };
  }
}
