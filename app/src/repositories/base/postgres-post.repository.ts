import type { Pool } from "pg";
import type { Post } from "../../domain/post.js";
import type {
  BasePostRepository,
  BaseUpdate,
  ListQuery,
} from "../types.js";

type PostRow = {
  id: string;
  title: string;
  content: string;
  author: string;
  tags: string[];
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = "id, title, content, author, tags, created_at, updated_at";

function rowToPost(row: PostRow): Post {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    author: row.author,
    tags: row.tags ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresPostRepository implements BasePostRepository {
  constructor(private readonly pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id UUID PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        author TEXT NOT NULL,
        tags TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
    `);
    await this.pool.query(
      "CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts (created_at DESC);",
    );
  }

  async insert(post: Post): Promise<Post> {
    const r = await this.pool.query<PostRow>(
      `INSERT INTO posts (id, title, content, author, tags, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNS}`,
      [
        post.id,
        post.title,
        post.content,
        post.author,
        post.tags,
        post.createdAt,
        post.updatedAt,
      ],
    );
    return rowToPost(r.rows[0]!);
  }

  async findById(id: string): Promise<Post | null> {
    const r = await this.pool.query<PostRow>(
      `SELECT ${COLUMNS} FROM posts WHERE id = $1`,
      [id],
    );
    const row = r.rows[0];
    return row ? rowToPost(row) : null;
  }

  async findAll(query: ListQuery = {}): Promise<Post[]> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);
    const r = await this.pool.query<PostRow>(
      `SELECT ${COLUMNS} FROM posts ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return r.rows.map(rowToPost);
  }

  async update(id: string, input: BaseUpdate): Promise<Post | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (input.title !== undefined) {
      sets.push(`title = $${i++}`);
      values.push(input.title);
    }
    if (input.content !== undefined) {
      sets.push(`content = $${i++}`);
      values.push(input.content);
    }
    if (input.author !== undefined) {
      sets.push(`author = $${i++}`);
      values.push(input.author);
    }
    if (input.tags !== undefined) {
      sets.push(`tags = $${i++}`);
      values.push(input.tags);
    }
    sets.push(`updated_at = $${i++}`);
    values.push(input.updatedAt);

    values.push(id);
    const r = await this.pool.query<PostRow>(
      `UPDATE posts SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${COLUMNS}`,
      values,
    );
    const row = r.rows[0];
    return row ? rowToPost(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    const r = await this.pool.query("DELETE FROM posts WHERE id = $1", [id]);
    return (r.rowCount ?? 0) > 0;
  }
}
