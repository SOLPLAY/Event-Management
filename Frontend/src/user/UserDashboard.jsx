import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import logo from "../assets/nitt-logo1.jfif";
import campusImage from "../assets/nit trichy.jpeg";
import { clearLoginSession } from "../eventApi";
import UserEventCard from "./UserEventCard";
import UserEventDetail from "./UserEventDetail";
import { eventViews, filterUserEvents, requestUserApi } from "./userApi";
import "./user.css";

export default function UserDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedEventId = searchParams.get("event_id");
  const tab = searchParams.get("tab") || "overview";
  const showPayment = searchParams.get("page") === "payment";

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
  const registeredCount = useMemo(
    () => events.filter((event) => event.my_registration).length,
    [events]
  );
  const upcomingCount = useMemo(
    () => events.filter((event) => event.phase !== "Ended").length,
    [events]
  );

  const openEvent = useCallback(
    (eventId) => setSearchParams({ event_id: String(eventId) }),
    [setSearchParams]
  );
  const closeEvent = useCallback(() => setSearchParams({}), [setSearchParams]);

  // Tab changes replace the history entry (Back leaves the event); the payment page is a real page (Back returns).
  const changeTab = useCallback(
    (nextTab) => setSearchParams({ event_id: selectedEventId, tab: nextTab }, { replace: true }),
    [setSearchParams, selectedEventId]
  );
  const openPayment = useCallback(
    () => setSearchParams({ event_id: selectedEventId, tab: "registration", page: "payment" }),
    [setSearchParams, selectedEventId]
  );
  const closePayment = useCallback(
    () => setSearchParams({ event_id: selectedEventId, tab: "registration" }),
    [setSearchParams, selectedEventId]
  );

  const displayName =
    profileName || window.sessionStorage.getItem("loginUsername") || "User";
  const avatarLetter = displayName.trim().charAt(0).toUpperCase() || "U";

  return (
    <main className="nitt-admin user-dashboard">
      <header className="nitt-admin__topbar">
        <div className="nitt-admin__brand">
          <img className="nitt-admin__brand-logo" src={logo} alt="" />
          <div>
            <div className="nitt-admin__brand-title">NIT TRICHY</div>
            <div className="nitt-admin__brand-sub">PARTICIPANT PORTAL</div>
          </div>
        </div>
        <div className="nitt-admin__session-actions user-session">
          <span className="user-session__avatar" aria-hidden="true">{avatarLetter}</span>
          <div className="user-session__identity">
            <span>Signed in as</span>
            <strong>{displayName}</strong>
          </div>
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
        {!selectedEventId && (
          <>
            <section className="user-welcome" aria-labelledby="user-heading">
              <div className="user-welcome__copy">
                <div className="nitt-admin__eyebrow">Your campus, your calendar</div>
                <h1 id="user-heading">Campus life, <span>your way.</span></h1>
                <p>
                  Discover what’s happening at NIT Trichy, find your people, and make
                  your next campus memory.
                </p>
                <div className="user-welcome__greeting">
                  Welcome back, <strong>{displayName}</strong>
                </div>
              </div>
              <div className="user-welcome__image">
                <img src={campusImage} alt="Aerial view of the NIT Trichy campus" />
                <span>NATIONAL INSTITUTE OF TECHNOLOGY · TIRUCHIRAPPALLI</span>
              </div>
            </section>

            <div className="user-stats" aria-label="Your event overview">
              <div className="user-stat">
                <span className="user-stat__icon" aria-hidden="true">✦</span>
                <div><strong>{loading ? "—" : events.length}</strong><span>Published events</span></div>
              </div>
              <div className="user-stat">
                <span className="user-stat__icon user-stat__icon--gold" aria-hidden="true">✓</span>
                <div><strong>{loading ? "—" : registeredCount}</strong><span>Your registrations</span></div>
              </div>
              <div className="user-stat">
                <span className="user-stat__icon user-stat__icon--blue" aria-hidden="true">↗</span>
                <div><strong>{loading ? "—" : upcomingCount}</strong><span>Upcoming &amp; ongoing</span></div>
              </div>
            </div>
          </>
        )}

        {selectedEventId && (
          <div className="user-page-context">
            <div className="nitt-admin__eyebrow">Your campus calendar</div>
            <h1 id="user-heading">Event details</h1>
          </div>
        )}

        {selectedEventId ? (
          <UserEventDetail
            key={selectedEventId}
            eventId={selectedEventId}
            initialEvent={events.find((item) => String(item.event_id) === selectedEventId)}
            tab={tab}
            showPayment={showPayment}
            onTabChange={changeTab}
            onOpenPayment={openPayment}
            onClosePayment={closePayment}
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
              <div className="user-event-toolbar__heading">
                <div>
                  <h2>Find your next event</h2>
                  <p>
                    {loading
                      ? "Loading the campus calendar…"
                      : `${filteredEvents.length} of ${events.length} events`}
                  </p>
                </div>
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
