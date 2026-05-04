import { useEffect, useState } from "react";

export type PostInput = {
  title: string;
  content: string;
  author: string;
  tags: string[];
};

export type PostFormProps = {
  initial?: Partial<PostInput>;
  submitLabel: string;
  onSubmit: (input: PostInput) => Promise<void>;
  onCancel?: () => void;
};

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export default function PostForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: PostFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [author, setAuthor] = useState(initial?.author ?? "");
  const [tagsText, setTagsText] = useState((initial?.tags ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setTitle(initial?.title ?? "");
    setContent(initial?.content ?? "");
    setAuthor(initial?.author ?? "");
    setTagsText((initial?.tags ?? []).join(", "));
  }, [initial?.title, initial?.content, initial?.author, initial?.tags]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({
        title: title.trim(),
        content: content.trim(),
        author: author.trim(),
        tags: parseTags(tagsText),
      });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="form-grid">
      <label>
        Başlıq
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>
      <label>
        Müəllif
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          required
        />
      </label>
      <label>
        Mətn
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
        />
      </label>
      <label>
        Etiketlər (vergüllə)
        <input
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="news, db, decision"
        />
      </label>
      {err && <div className="err">{err}</div>}
      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? "Göndərilir…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            className="ghost"
            onClick={onCancel}
            disabled={busy}
          >
            Ləğv et
          </button>
        )}
      </div>
    </form>
  );
}
