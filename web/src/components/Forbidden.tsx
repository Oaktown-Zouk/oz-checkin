export function Forbidden({ email, role, onLogout }: { email: string; role: string; onLogout: () => void }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>Oaktown Zouk Front Desk</h1>
        <p>
          Signed in as <strong>{email}</strong> ({role}) — this app doesn't have any pages built for that role yet.
        </p>
        <button type="button" className="btn btn-secondary" onClick={onLogout}>
          Sign in with a different account
        </button>
      </div>
    </div>
  );
}
