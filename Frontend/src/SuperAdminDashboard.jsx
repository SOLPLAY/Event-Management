import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import logo from "./assets/nitt-logo1.jfif";
import EventCard from "./EventCard";
import {
  clearLoginSession,
  eventStatuses,
  filterEvents,
  requestEventApi,
} from "./eventApi";

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyEventId, setBusyEventId] = useState(null);
  const [error, setError] = useState("");

  const loadEvents = useCallback(async () => {
    try {
      const result = await requestEventApi("/super-admin/events");
      if (!Array.isArray(result.data)) {
        throw new Error("The server response did not contain an event list.");
      }
      setEvents(result.data);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function fetchInitialEvents() {
      try {
        const result = await requestEventApi("/super-admin/events");
        if (!Array.isArray(result.data)) {
          throw new Error("The server response did not contain an event list.");
        }
        if (active) {
          setEvents(result.data);
          setError("");
        }
      } catch (requestError) {
        if (active) setError(requestError.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchInitialEvents();
    return () => {
      active = false;
    };
  }, []);

  const filteredEvents = useMemo(
    () => filterEvents(events, query, selectedStatus),
    [events, query, selectedStatus]
  );

  async function decideEvent(eventId, decision) {
    setBusyEventId(eventId);
    setError("");
    try {
      await requestEventApi(`/super-admin/events/${eventId}/decision`, {
        method: "PATCH",
        body: JSON.stringify({ decision }),
      });
      await loadEvents();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyEventId(null);
    }
  }

  function logout() {
    clearLoginSession();
    navigate("/", { replace: true });
  }

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
          <div className="nitt-admin__profile">
            Signed in as {window.sessionStorage.getItem("loginUsername") || "Super Admin"}
          </div>
          <button
            className="nitt-admin__button nitt-admin__button--quiet"
            type="button"
            onClick={logout}
          >
            Logout
          </button>
        </div>
      </header>

      <section className="nitt-admin__content" aria-labelledby="events-heading">
        <div className="nitt-admin__eyebrow">Event approvals</div>
        <div className="nitt-admin__heading">
          <div>
            <h1 id="events-heading">Event requests</h1>
            <p>Review and manage events submitted by organizers.</p>
          </div>
        </div>
        {error && (
          <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
            {error}
            <button
              className="nitt-admin__action"
              type="button"
              onClick={() => {
                setLoading(true);
                loadEvents();
              }}
              disabled={loading}
            >
              Retry
            </button>
          </p>
        )}

        <div className="event-toolbar">
          <div className="nitt-admin__count">
            {loading ? "Loading events…" : `${filteredEvents.length} of ${events.length} events`}
          </div>
          <div className="event-toolbar__filters">
            <label>
              <span className="sr-only">Search events</span>
              <input
                className="nitt-admin__search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search events or organizers…"
              />
            </label>
            <label>
              <span className="sr-only">Filter by event status</span>
              <select
                className="nitt-admin__search"
                value={selectedStatus}
                onChange={(event) => setSelectedStatus(event.target.value)}
              >
                {eventStatuses.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
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
              <EventCard
                key={event.event_id}
                event={event}
                mode="super-admin"
                busy={busyEventId === event.event_id}
                onDecision={decideEvent}
              />
            ))}
          </div>
        ) : (
          <p className="event-list-message">
            {events.length ? "No events match your search or status filter." : "No event requests yet."}
          </p>
        )}
      </section>
    </main>
  );
}
