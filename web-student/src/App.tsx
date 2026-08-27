import { useEffect, useState } from "react";
import { GoogleLogo } from "shared";
import type { StudentTimeline } from "shared";
import { api, UnauthorizedError, ForbiddenError } from "./api.js";
import { StudentSelfPage } from "./components/StudentSelfPage.js";

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "That Google account isn't linked to a student record. Ask the front desk if this seems wrong.",
  oauth_failed: "Sign-in failed. Please try again.",
};

// Much simpler than the staff app's App.tsx: exactly one authenticated view (this
// student's own timeline), no client-side routing, no permissions to branch on — a
// signed-in session here is always exactly a Student session (see
// server/src/studentApp.ts's /api/session).
export function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [timeline, setTimeline] = useState<StudentTimeline | null>(null);
  const [authError] = useState(() => new URLSearchParams(window.location.search).get("authError"));

  function load() {
    api
      .timeline()
      .then(setTimeline)
      .catch((err) => {
        if (err instanceof UnauthorizedError || err instanceof ForbiddenError) setTimeline(null);
      })
      .finally(() => setAuthChecked(true));
  }

  useEffect(() => {
    api
      .session()
      .then((s) => {
        if (s.authenticated) load();
        else setAuthChecked(true);
      })
      .catch(() => setAuthChecked(true));
  }, []);

  function handleLogout() {
    api.logout().finally(() => {
      window.location.href = "/";
    });
  }

  if (!authChecked) return null;

  if (!timeline) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>Oaktown Zouk — My Progress</h1>
          {authError && <p className="error">{ERROR_MESSAGES[authError] ?? "Sign-in failed. Please try again."}</p>}
          {/* Full-page navigation, not a fetch — Google needs to redirect the browser itself. */}
          <a className="google-signin-btn" href="/api/auth/google/start">
            <GoogleLogo />
            <span>Sign in with Google</span>
          </a>
        </div>
      </div>
    );
  }

  return <StudentSelfPage timeline={timeline} onLogout={handleLogout} />;
}
