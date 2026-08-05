import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";

import Login         from "./pages/Login";
import Dashboard     from "./pages/Dashboard";
import Accounts      from "./pages/Accounts";
import AccountDetail from "./pages/AccountDetail";
import Income        from "./pages/Income";
import Digigold      from "./pages/Digigold";
import DigigoldTransactions from "./pages/DigigoldTransactions";
import ScrapeRuns    from "./pages/ScrapeRuns";
import Settings      from "./pages/Settings";
import { supabase }  from "./lib/supabase";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [authed,  setAuthed]  = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session);
      setChecked(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!checked) return null;
  return authed ? <>{children}</> : <Navigate to="/login" replace />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/"                    element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/accounts"            element={<RequireAuth><Accounts /></RequireAuth>} />
        <Route path="/accounts/:memberId"  element={<RequireAuth><AccountDetail /></RequireAuth>} />
        <Route path="/income"              element={<RequireAuth><Income /></RequireAuth>} />
        <Route path="/digigold"            element={<RequireAuth><Digigold /></RequireAuth>} />
        <Route path="/digigold/transactions" element={<RequireAuth><DigigoldTransactions /></RequireAuth>} />
        <Route path="/scrape-runs"         element={<RequireAuth><ScrapeRuns /></RequireAuth>} />
        <Route path="/settings"            element={<RequireAuth><Settings /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
