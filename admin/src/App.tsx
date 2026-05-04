import { useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import Header from "./components/Header";
import AdminPage from "./pages/AdminPage";
import PostsPage from "./pages/PostsPage";

export default function App() {
  const navigate = useNavigate();

  useEffect(() => {
    const onLogout = () => navigate("/admin", { replace: true });
    window.addEventListener("diss:auth:logout", onLogout);
    return () => window.removeEventListener("diss:auth:logout", onLogout);
  }, [navigate]);

  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<PostsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<PostsPage />} />
      </Routes>
    </>
  );
}
