import { useEffect, useState } from "react";
import { formatEventDate } from "../eventApi";
import { formatDateTime, requestUserApi } from "./userApi";

// Mount this with key={eventId} so it starts fresh for every event.
export default function UserEventDetail({ eventId, onBack, onAuthError }) {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadEvent() {
      try {
        const result = await requestUserApi(`/events/${eventId}`);
        if (!result.data || typeof result.data !== "object") {
          throw new Error("The server response did not contain this event.");
        }
        if (active) setEvent(result.data);
      } catch (requestError) {
        if (!active) return;
        if (requestError.status === 401) {
          onAuthError();
          return;
        }
        setError(requestError.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadEvent();
    return () => {
      active = false;
    };
  }, [eventId, onAuthError]);

  return (
    <div className="user-detail">
      <button
        className="nitt-admin__button nitt-admin__button--quiet user-detail__back"
        type="button"
        onClick={onBack}
      >
        ← All events
      </button>

      {loading && <p className="event-list-message">Loading event…</p>}

      {!loading && error && (
        <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
          {error}
        </p>
      )}

      {!loading && event && (
        <article className="user-detail__panel">
          <div className="user-detail__topline">
            <span className={`user-phase user-phase--${event.phase.toLowerCase()}`}>
              {event.phase}
            </span>
            <span className="event-card__type">{event.type || "Event"}</span>
          </div>
          <h2 className="user-detail__title">{event.name}</h2>
          <p className="user-detail__description">
            {event.description || "No description has been provided for this event."}
          </p>

          <dl className="user-detail__facts">
            <div>
              <dt>Start date</dt>
              <dd>{formatEventDate(event.start_date)}</dd>
            </div>
            <div>
              <dt>End date</dt>
              <dd>{formatEventDate(event.end_date)}</dd>
            </div>
            <div>
              <dt>Organised by</dt>
              <dd>{event.organizers?.length ? event.organizers.join(", ") : "Not listed"}</dd>
            </div>
          </dl>

          <section className="user-detail__section" aria-labelledby="schedule-heading">
            <h3 id="schedule-heading">Schedule</h3>
            {event.sessions?.length ? (
              <ol className="user-schedule">
                {event.sessions.map((session) => (
                  <li key={session.session_id}>
                    <div className="user-schedule__time">
                      {formatDateTime(session.start_time)} – {formatDateTime(session.end_time)}
                    </div>
                    <div className="user-schedule__title">{session.session_title}</div>
                    <div className="user-schedule__meta">
                      {[session.speaker_name, session.venue].filter(Boolean).join(" · ") ||
                        "Details to be announced"}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="user-detail__muted">The schedule has not been announced yet.</p>
            )}
          </section>

          <section className="user-detail__section" aria-labelledby="registration-heading">
            <h3 id="registration-heading">Registration</h3>
            {event.my_registration ? (
              <p className="user-registered">
                You are registered · {event.my_registration.status}
              </p>
            ) : (
              <p className="user-detail__muted">
                Online registration is not available in this version yet.
              </p>
            )}
          </section>
        </article>
      )}
    </div>
  );
}
