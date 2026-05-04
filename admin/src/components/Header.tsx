import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../theme/ThemeContext";

export default function Header() {
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();

  return (
    <header className="header">
      <div className="header-inner">
        <NavLink
          to="/"
          className="brand"
          title="Adaptive Data Management System"
          aria-label="Adaptive Data Management System (ADMS)"
        >
          <span className="brand-dot" />
          ADMS
        </NavLink>
        <nav className="nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? "active" : undefined)}
          >
            Posts
          </NavLink>
          <NavLink
            to="/admin"
            className={({ isActive }) => (isActive ? "active" : undefined)}
          >
            Admin
          </NavLink>
        </nav>
        <div className="row">
          {user && (
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              {user.username} <span className="badge">{user.role}</span>
            </span>
          )}
          {user && (
            <button
              type="button"
              className="ghost"
              onClick={() => void logout()}
            >
              Çıxış
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label="Tema dəyiş"
            title={theme === "dark" ? "İşıqlı tema" : "Qaranlıq tema"}
            onClick={toggle}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </div>
    </header>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
