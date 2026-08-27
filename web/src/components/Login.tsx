import { useState } from "react";
import { api, UnauthorizedError } from "../api.js";
import { GoogleLogo } from "shared";

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "That Google account isn't set up for this app. Ask an admin to add you.",
  oauth_failed: "Sign-in failed. Please try again.",
};

// Two independent ways to sign in on the same screen: Google OAuth (Staff/Volunteer/
// Admin, an accountable personal login) or a plain identifier/password (see
// routes/auth.ts's /auth/kiosk-login) — used for kiosk tablets, which are shared,
// unattended devices with no Google account on them. Password auth uses a properly
// salted/hashed scheme (server/src/lib/password.ts), so there's no security reason to
// force every login through OAuth; this form works for any account with a password
// set, not just Kiosk-role ones. Whichever one succeeds lands on the same session
// cookie, so there's nothing route-specific to pick here — App.tsx's session-derived
// routing sends the browser wherever that account actually belongs (e.g. a
// Kiosk-role account ends up on /kiosk regardless of where login happened).
export function Login({ authError }: { authError: string | null }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setSubmitting(true);
    try {
      await api.kioskLogin(identifier, password);
      // Forces a fresh session check on load, same pattern used after OAuth/logout.
      window.location.href = "/";
    } catch (err) {
      setPasswordError(err instanceof UnauthorizedError ? "Invalid login or password." : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>Oaktown Zouk Front Desk</h1>
        {authError && <p className="error">{ERROR_MESSAGES[authError] ?? "Sign-in failed. Please try again."}</p>}
        {/* Full-page navigation, not a fetch — Google needs to redirect the browser itself. */}
        <a className="google-signin-btn" href="/api/auth/google/start">
          <GoogleLogo />
          <span>Sign in with Google</span>
        </a>

        <div className="login-divider">
          <span>or</span>
        </div>

        {passwordError && <p className="error">{passwordError}</p>}
        <form onSubmit={handlePasswordSubmit}>
          <input type="text" placeholder="Login" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={submitting || !identifier || !password}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
