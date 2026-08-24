import { useState } from "react";
import { api, UnauthorizedError } from "../api.js";

// Password login for kiosk tablets — see server/src/routes/auth.ts's /auth/kiosk-login
// and SPEC.md's "Auth" section. Shown instead of <Login> specifically for the /kiosk
// route, since these are unattended shared devices with no Google account on them.
export function KioskLogin() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.kioskLogin(identifier, password);
      // Forces a fresh session check on load, same pattern used after OAuth/logout.
      window.location.href = "/kiosk";
    } catch (err) {
      setError(err instanceof UnauthorizedError ? "Invalid login or password." : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>Oaktown Zouk Kiosk</h1>
        {error && <p className="error">{error}</p>}
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Login"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoFocus
          />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={submitting || !identifier || !password}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
