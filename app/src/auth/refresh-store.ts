import type { RedisAdapter } from "../adapters/index.js";

const PREFIX = "diss:auth:refresh:";

function key(jti: string): string {
  return PREFIX + jti;
}

export class RefreshTokenStore {
  constructor(
    private readonly redis: RedisAdapter,
    private readonly ttlSec: number,
  ) {}

  async save(jti: string, userId: string): Promise<void> {
    await this.redis.client.set(key(jti), userId, { EX: this.ttlSec });
  }

  /**
   * Atomic consume: returns userId and deletes key.
   * If key missing → returns null (token reuse / expired).
   */
  async consume(jti: string): Promise<string | null> {
    const k = key(jti);
    const client = this.redis.client as unknown as {
      sendCommand?: (args: string[]) => Promise<unknown>;
    };

    if (typeof client.sendCommand === "function") {
      try {
        const v = await client.sendCommand(["GETDEL", k]);
        if (typeof v === "string" && v.length > 0) return v;
        if (v == null) return null;
      } catch {
        // fall through to non-atomic fallback
      }
    }
    const userId = await this.redis.client.get(k);
    if (!userId) return null;
    await this.redis.client.del(k);
    return userId;
  }

  async revoke(jti: string): Promise<void> {
    await this.redis.client.del(key(jti));
  }
}
