import { useAuth } from "../auth/AuthContext";
import AnalyticsDashboard from "./AnalyticsDashboard";
import LoginForm from "./LoginForm";

export default function AdminPage() {
  const { user, accessToken } = useAuth();

  if (!accessToken || !user) {
    return <LoginForm />;
  }
  if (user.role !== "admin") {
    return (
      <div className="wrap">
        <div className="panel">
          <h1>İcazə yoxdur</h1>
          <p className="muted">
            Bu səhifə yalnız <strong>admin</strong> role-u üçündür. Cari
            istifadəçi: <strong>{user.username}</strong> ({user.role}).
          </p>
        </div>
      </div>
    );
  }
  return <AnalyticsDashboard />;
}
