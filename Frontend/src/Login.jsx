import { useState } from "react";
import { useNavigate } from "react-router-dom";
import campusImage from "./assets/nitt-orion.jfif";
import logo from "./assets/nitt-logo1.jfif";

export default function Login() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof result.detail === "string"
            ? result.detail
            : "Unable to sign in. Please check your ID and password."
        );
      }

      const role = result.data?.role?.trim().toLowerCase();
      const destinations = {
        "system administrator": "/admin",
        admin: "/admin",
        "super admin": "/super-admin",
        "event organizer": "/event-organizer",
      };
      const destination = destinations[role];
      if (!destination) {
        setError(
          `Your account is verified, but a home page is not configured for the ${result.data?.role || "assigned"} role yet.`
        );
      } else if (!result.data?.access_token) {
        setError("Sign in succeeded, but the server did not start an authenticated session.");
      } else {
        window.sessionStorage.setItem("loginUsername", result.data.username);
        window.sessionStorage.setItem("personId", String(result.data.person_id));
        window.sessionStorage.setItem("loginRole", result.data.role);
        window.sessionStorage.setItem("accessToken", result.data.access_token);
        navigate(destination, { replace: true });
      }
    } catch (requestError) {
      setError(
        requestError instanceof TypeError
          ? "Unable to connect to the server. Please make sure the backend is running."
          : requestError.message
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
          <p className="nitt-login__intro">Sign in with your institute ID to continue.</p>
          <form onSubmit={handleSubmit}>
            <label className="nitt-login__field">
              <span>Username or login ID</span>
              <input
                autoComplete="username"
                type="text"
                name="identifier"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
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
              {loading ? "Signing in…" : "Sign in"}
            </button>
            {error && (
              <p className="nitt-login__error" role="alert">
                {error}
              </p>
            )}
          </form>
          <p className="nitt-login__note">
            Use the username or numeric login ID associated with your account.
          </p>
        </div>
      </section>
    </main>
  );
}
