import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import logo from "../assets/nitt-logo1.jfif";
import { clearLoginSession } from "../eventApi";
import UserEventCard from "./UserEventCard";
import UserEventDetail from "./UserEventDetail";
import { eventViews, filterUserEvents, requestUserApi } from "./userApi";
import "./user.css";

export default function UserDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedEventId = searchParams.get("event_id");

  const [events, setEvents] = useState([]);
  const [profileName, setProfileName] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("current");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const signOut = useCallback(() => {
    clearLoginSession();
    navigate("/", { replace: true });
  }, [navigate]);

  // Load the list on arrival and every time the user comes back from an event page
  // (Back button, browser back, ...), so registration badges are always up to date.
  // Changing reloadKey (the Retry button) loads it again.
  useEffect(() => {
    if (selectedEventId) return undefined;
    let active = true;

    async function loadEvents() {
      try {
        const result = await requestUserApi("/events");
        if (!Array.isArray(result.data)) {
          throw new Error("The server response did not contain an event list.");
        }
        if (active) {
          setEvents(result.data);
          setError("");
        }
      } catch (requestError) {
        if (!active) return;
        if (requestError.status === 401) {
          signOut();
          return;
        }
        setError(requestError.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadEvents();
    return () => {
      active = false;
    };
  }, [selectedEventId, reloadKey, signOut]);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      // The name is only decoration, so a failure here is ignored.
      try {
        const me = await requestUserApi("/me");
        if (active && me.data?.name) setProfileName(me.data.name);
      } catch {
        /* ignore */
      }
    }

    loadProfile();
    return () => {
      active = false;
    };
  }, []);

  const filteredEvents = useMemo(
    () => filterUserEvents(events, query, view),
    [events, query, view]
  );

  const openEvent = useCallback(
    (eventId) => setSearchParams({ event_id: String(eventId) }),
    [setSearchParams]
  );
  const closeEvent = useCallback(() => setSearchParams({}), [setSearchParams]);

  const displayName =
    profileName || window.sessionStorage.getItem("loginUsername") || "User";

  return (
    <main className="nitt-admin">
      <header className="nitt-admin__topbar">
        <div className="nitt-admin__brand">
          <img className="nitt-admin__brand-logo" src={logo} alt="" />
          <div>
            <div className="nitt-admin__brand-title">NIT TRICHY</div>
            <div className="nitt-admin__brand-sub">EVENT MANAGEMENT PORTAL</div>
          </div>
        </div>
        <div className="nitt-admin__session-actions">
          <div className="nitt-admin__profile">Signed in as {displayName}</div>
          <button
            className="nitt-admin__button nitt-admin__button--quiet"
            type="button"
            onClick={signOut}
          >
            Logout
          </button>
        </div>
      </header>

      <section className="nitt-admin__content" aria-labelledby="user-heading">
        <div className="nitt-admin__eyebrow">Events</div>
        <div className="nitt-admin__heading">
          <div>
            <h1 id="user-heading">Discover events</h1>
            <p>Browse the events happening at NIT Trichy.</p>
          </div>
        </div>

        {selectedEventId ? (
          <UserEventDetail
            key={selectedEventId}
            eventId={selectedEventId}
            onBack={closeEvent}
            onAuthError={signOut}
          />
        ) : (
          <>
            {error && (
              <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
                {error}
                <button
                  className="nitt-admin__action"
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setReloadKey((key) => key + 1);
                  }}
                  disabled={loading}
                >
                  Retry
                </button>
              </p>
            )}

            <div className="event-toolbar">
              <div className="nitt-admin__count">
                {loading
                  ? "Loading events…"
                  : `${filteredEvents.length} of ${events.length} events`}
              </div>
              <div className="event-toolbar__filters">
                <label>
                  <span className="sr-only">Search events</span>
                  <input
                    className="nitt-admin__search"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search events or organisers…"
                  />
                </label>
                <label>
                  <span className="sr-only">Show events</span>
                  <select
                    className="nitt-admin__search"
                    value={view}
                    onChange={(event) => setView(event.target.value)}
                  >
                    {eventViews.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {loading ? (
              <p className="event-list-message">Loading events…</p>
            ) : filteredEvents.length ? (
              <div className="event-card-grid">
                {filteredEvents.map((event) => (
                  <UserEventCard key={event.event_id} event={event} onOpen={openEvent} />
                ))}
              </div>
            ) : (
              <p className="event-list-message">
                {view === "registered" && events.length
                  ? "You have not registered for any event yet."
                  : events.length
                    ? "No events match your search or filter."
                    : "No events have been published yet."}
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
