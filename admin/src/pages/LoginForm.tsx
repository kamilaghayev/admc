import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";

export default function LoginForm() {
  const { login, loading } = useAuth();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await login(username, password);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    }
  };

  return (
    <div className="wrap">
      <div className="panel login-card">
        <h1>Admin daxil ol</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Yalnız admin role-u olan istifadəçilər metrika panelini görə bilər.
        </p>
        <form onSubmit={submit} className="form-grid">
          <label>
            İstifadəçi adı
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            Parol
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {err && <div className="err">{err}</div>}
          <button type="submit" disabled={loading}>
            {loading ? "Yoxlanılır…" : "Daxil ol"}
          </button>
        </form>
      </div>
    </div>
  );
}
