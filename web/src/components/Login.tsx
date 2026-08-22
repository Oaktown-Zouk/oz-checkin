const ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "That Google account isn't set up for this app. Ask an admin to add you.",
  oauth_failed: "Sign-in failed. Please try again.",
};

export function Login({ authError }: { authError: string | null }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>Oaktown Zouk Front Desk</h1>
        {authError && <p className="error">{ERROR_MESSAGES[authError] ?? "Sign-in failed. Please try again."}</p>}
        {/* Full-page navigation, not a fetch — Google needs to redirect the browser itself. */}
        <a className="btn btn-primary" href="/api/auth/google/start">
          Sign in with Google
        </a>
      </div>
    </div>
  );
}
