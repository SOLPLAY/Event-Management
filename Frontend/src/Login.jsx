import { useState } from "react";
import campusImage from "./assets/nitt-orion.jfif";
import logo from "./assets/nitt-logo1.jfif";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      // POST /login in the supplied backend creates a login record; it is not an authentication endpoint.
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      setError(
        "Sign-in is not available yet. The supplied backend's POST /login creates a login record; it does not authenticate or issue a session/token, so it cannot determine a role for redirect."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="nitt-login">
      <header className="nitt-login__brand">
        <img className="nitt-login__brand-logo" src={logo} alt="NIT Trichy logo" />
        <div className="nitt-login__brand-copy">
          NIT TRICHY
          <span>EVENT MANAGEMENT PORTAL</span>
        </div>
      </header>

      <section className="nitt-login__card" aria-labelledby="login-heading">
        <div className="nitt-login__visual">
          <img className="nitt-login__visual-image" src={campusImage} alt="" />
          <div className="nitt-login__visual-copy">
            <div className="nitt-login__eyebrow">Campus life, connected</div>
            <h1>Make every gathering matter.</h1>
            <p>One place for the people and ideas that bring our campus together.</p>
          </div>
        </div>

        <div className="nitt-login__form-panel">
          <h2 id="login-heading">Welcome back</h2>
          <p className="nitt-login__intro">Sign in with your institute account to continue.</p>
          <form onSubmit={handleSubmit}>
            <label className="nitt-login__field">
              <span>Email address</span>
              <input
                autoComplete="username"
                type="email"
                name="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={loading}
              />
            </label>
            <label className="nitt-login__field">
              <span>Password</span>
              <input
                autoComplete="current-password"
                type="password"
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={loading}
              />
            </label>
            <button className="nitt-login__submit" type="submit" disabled={loading}>
              {loading ? "Checking availability…" : "Sign in"}
            </button>
            {error && <p className="nitt-login__error" role="alert">{error}</p>}
          </form>
          <p className="nitt-login__note">
            Your credentials are not sent or stored by this prototype. Authentication must be connected
            to a backend auth contract before sign-in can be enabled.
          </p>
        </div>
      </section>
    </main>
  );
}
