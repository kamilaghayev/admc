import { Pool } from "pg";

export type PostgresAdapter = {
  pool: Pool;
  ping: () => Promise<boolean>;
  close: () => Promise<void>;
};

export async function createPostgresAdapter(
  databaseUrl: string,
): Promise<PostgresAdapter> {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });

  const ping = async (): Promise<boolean> => {
    try {
      const r = await pool.query("SELECT 1 AS ok");
      return r.rows[0]?.ok === 1;
    } catch {
      return false;
    }
  };

  await pool.query("SELECT 1");

  return {
    pool,
    ping,
    close: () => pool.end(),
  };
}
