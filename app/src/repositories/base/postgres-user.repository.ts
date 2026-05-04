import type { Pool } from "pg";
import type { User, UserRole } from "../../domain/user.js";
import type { BaseUserRepository, ListQuery } from "../types.js";

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = "id, username, password_hash, role, created_at, updated_at";

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresUserRepository implements BaseUserRepository {
  constructor(private readonly pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
    `);
    await this.pool.query(
      "CREATE INDEX IF NOT EXISTS users_username_idx ON users (username);",
    );
  }

  async insert(user: User): Promise<User> {
    const r = await this.pool.query<UserRow>(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS}`,
      [
        user.id,
        user.username,
        user.passwordHash,
        user.role,
        user.createdAt,
        user.updatedAt,
      ],
    );
    return rowToUser(r.rows[0]!);
  }

  async findById(id: string): Promise<User | null> {
    const r = await this.pool.query<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE id = $1`,
      [id],
    );
    const row = r.rows[0];
    return row ? rowToUser(row) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const r = await this.pool.query<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE username = $1`,
      [username],
    );
    const row = r.rows[0];
    return row ? rowToUser(row) : null;
  }

  async findAll(query: ListQuery = {}): Promise<User[]> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);
    const r = await this.pool.query<UserRow>(
      `SELECT ${COLUMNS} FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return r.rows.map(rowToUser);
  }
}
