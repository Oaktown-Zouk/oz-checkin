import { useState } from "react";
import { api, UnauthorizedError } from "../api.js";

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "That Google account isn't set up for this app. Ask an admin to add you.",
  oauth_failed: "Sign-in failed. Please try again.",
};

// The standard four-color "G" mark from Google's own Sign In branding guidelines —
// required as-is (not recolored/simplified) alongside the button styling below to
// count as a conforming "Sign in with Google" button.
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

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
