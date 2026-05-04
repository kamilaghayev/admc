import { createClient } from "redis";

export type RedisAdapter = {
  client: ReturnType<typeof createClient>;
  ping: () => Promise<boolean>;
  close: () => Promise<void>;
};

export async function createRedisAdapter(url: string): Promise<RedisAdapter> {
  const client: ReturnType<typeof createClient> = createClient({ url });
  await client.connect();

  const ping = async (): Promise<boolean> => {
    try {
      const r = await client.ping();
      return r === "PONG";
    } catch {
      return false;
    }
  };

  return {
    client,
    ping,
    close: async () => {
      await client.quit();
    },
  };
}
