import { useEffect, useState } from "react";
import { formatEventDate } from "../eventApi";
import { formatDateTime, formatFee, requestUserApi } from "./userApi";

async function fetchEvent(eventId) {
  const result = await requestUserApi(`/events/${eventId}`);
  if (!result.data || typeof result.data !== "object") {
    throw new Error("The server response did not contain this event.");
  }
  return result.data;
}

function RegistrationPanel({ event, registering, onRegister }) {
  const registration = event.my_registration;
  const fee = event.fee;
  const feeKnown = fee !== null && fee !== undefined;
  const isFree = feeKnown && Number(fee) === 0;

  if (registration) {
    const confirmed = registration.status === "Confirmed";
    return (
      <>
        <p className="user-registered">You are registered · {registration.status}</p>
        <p className="user-detail__muted user-register__hint">
          {confirmed
            ? "Your place is confirmed."
            : feeKnown && !isFree
              ? `Your registration is pending until your payment of ${formatFee(fee)} is verified. Online payment is not available in this version yet.`
              : "Your registration is pending."}
        </p>
      </>
    );
  }

  if (!event.registration_open) {
    return <p className="user-detail__muted">Registration is closed for this event.</p>;
  }

  if (!feeKnown) {
    return (
      <p className="user-detail__muted">
        Registration is not available yet: the fee for this event has not been set up.
      </p>
    );
  }

  return (
    <div className="user-register">
      <div className="user-register__fee">
        <span>Registration fee</span>
        <strong>{formatFee(fee)}</strong>
      </div>
      <button
        className="nitt-admin__button nitt-admin__button--primary"
        type="button"
        onClick={onRegister}
        disabled={registering}
      >
        {registering ? "Registering…" : "Register for this event"}
      </button>
      {!isFree && (
        <p className="user-detail__muted user-register__hint">
          Your registration will be pending until your payment is verified.
        </p>
      )}
    </div>
  );
}

// Mount this with key={eventId} so it starts fresh for every event.
export default function UserEventDetail({ eventId, onBack, onAuthError }) {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState("");
  const [registerNotice, setRegisterNotice] = useState("");

  useEffect(() => {
    let active = true;

    async function loadEvent() {
      try {
        const data = await fetchEvent(eventId);
        if (active) setEvent(data);
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

  async function handleRegister() {
    if (registering) return;
    setRegistering(true);
    setRegisterError("");
    setRegisterNotice("");

    try {
      const result = await requestUserApi(`/events/${eventId}/register`, { method: "POST" });
      const registration = result.data;
      if (!registration?.status) {
        throw new Error("The server did not confirm the registration. Please check again.");
      }
      setEvent((current) => ({ ...current, my_registration: { status: registration.status } }));
      setRegisterNotice(registration.message || "You are registered for this event.");
    } catch (requestError) {
      if (requestError.status === 401) {
        onAuthError();
        return;
      }
      setRegisterError(requestError.message);
      if (requestError.status === 409) {
        // Already registered (another tab) or registration just closed: show the true state.
        try {
          setEvent(await fetchEvent(eventId));
        } catch {
          /* keep what is on screen */
        }
      }
    } finally {
      setRegistering(false);
    }
  }

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
              <dt>Registration fee</dt>
              <dd>{formatFee(event.fee)}</dd>
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
            {registerNotice && (
              <p className="user-notice user-notice--success" role="status">
                {registerNotice}
              </p>
            )}
            {registerError && (
              <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
                {registerError}
              </p>
            )}
            <RegistrationPanel
              event={event}
              registering={registering}
              onRegister={handleRegister}
            />
          </section>
        </article>
      )}
    </div>
  );
}
