import { MongoClient, type Db } from "mongodb";

export type MongoAdapter = {
  client: MongoClient;
  db: Db;
  ping: () => Promise<boolean>;
  close: () => Promise<void>;
};

export async function createMongoAdapter(uri: string): Promise<MongoAdapter> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  const ping = async (): Promise<boolean> => {
    try {
      const r = await db.command({ ping: 1 });
      return r.ok === 1;
    } catch {
      return false;
    }
  };

  return {
    client,
    db,
    ping,
    close: () => client.close(),
  };
}
