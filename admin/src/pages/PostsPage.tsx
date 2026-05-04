import { useCallback, useEffect, useState } from "react";
import PostForm, { type PostInput } from "../components/PostForm";

type Post = {
  id: string;
  title: string;
  content: string;
  author: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body && !(init.headers as Record<string, string> | undefined)?.["Content-Type"]
        ? { "Content-Type": "application/json" }
        : {}),
    },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`${path} ${r.status}: ${txt}`);
  }
  if (r.status === 204) return undefined as unknown as T;
  return r.json() as Promise<T>;
}

export default function PostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await api<Post[]>("/api/posts");
      setPosts(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (input: PostInput) => {
    await api<Post>("/api/posts", {
      method: "POST",
      body: JSON.stringify(input),
    });
    await load();
  };

  const update = async (id: string, input: PostInput) => {
    await api<Post>(`/api/posts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    setEditingId(null);
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm("Bu post silinsin?")) return;
    await api<void>(`/api/posts/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className="wrap">
      <div className="row between" style={{ marginBottom: "0.5rem" }}>
        <h1>Postlar</h1>
        <button className="ghost" onClick={() => void load()} disabled={loading}>
          {loading ? "Yenilənir…" : "Yenilə"}
        </button>
      </div>

      <div className="panel">
        <h2>Yeni post</h2>
        <PostForm submitLabel="Yarat" onSubmit={create} />
      </div>

      {err && (
        <div className="panel">
          <div className="err">{err}</div>
        </div>
      )}

      <div className="stack">
        {posts.length === 0 && !loading && (
          <div className="panel muted">Hələ post yoxdur.</div>
        )}
        {posts.map((p) =>
          editingId === p.id ? (
            <div className="panel" key={p.id}>
              <h2>Redaktə</h2>
              <PostForm
                initial={p}
                submitLabel="Yadda saxla"
                onSubmit={(input) => update(p.id, input)}
                onCancel={() => setEditingId(null)}
              />
            </div>
          ) : (
            <article className="post-card" key={p.id}>
              <div className="row between">
                <strong>{p.title}</strong>
                <div className="row">
                  <button
                    className="ghost"
                    onClick={() => setEditingId(p.id)}
                  >
                    Redaktə
                  </button>
                  <button
                    className="danger"
                    onClick={() => void remove(p.id)}
                  >
                    Sil
                  </button>
                </div>
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{p.content}</div>
              <div className="post-meta">
                <span>by {p.author}</span>
                <span>{new Date(p.createdAt).toLocaleString()}</span>
                {p.tags.map((t) => (
                  <span className="post-tag" key={t}>
                    #{t}
                  </span>
                ))}
              </div>
            </article>
          ),
        )}
      </div>
    </div>
  );
}
