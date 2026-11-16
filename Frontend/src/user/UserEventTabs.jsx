import { useEffect, useState } from "react";
import { formatEventDate } from "../eventApi";
import { formatDateTime, ordinal } from "./userApi";

// Shows one tab's data. It comes from the event's cache (see createTabCache), so a tab that was
// prefetched or opened before appears instantly. Mount it with a key per tab.
function LazyTab({ cache, resource, onAuthError, children }) {
  const cached = cache.peek(resource);
  const [state, setState] = useState({
    loading: cached === undefined,
    data: cached ?? null,
    error: "",
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await cache.load(resource);
        if (active) setState({ loading: false, data, error: "" });
      } catch (requestError) {
        if (!active) return;
        if (requestError.status === 401) {
          onAuthError();
          return;
        }
        setState({ loading: false, data: null, error: requestError.message });
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [cache, resource, reloadKey, onAuthError]);

  if (state.loading) return <p className="event-list-message">Loading…</p>;

  if (state.error) {
    return (
      <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
        {state.error}
        <button
          className="nitt-admin__action"
          type="button"
          onClick={() => {
            setState({ loading: true, data: null, error: "" });
            setReloadKey((key) => key + 1);
          }}
        >
          Retry
        </button>
      </p>
    );
  }

  return children(state.data);
}

export function HospitalityTab({ cache, onAuthError }) {
  return (
    <LazyTab cache={cache} resource="hospitality" onAuthError={onAuthError}>
      {(data) =>
        data.items?.length ? (
          <ul className="user-list">
            {data.items.map((item) => (
              <li key={item.hospitality_id} className="user-list__row">
                <span className="user-list__main">{item.meal_type || "Meal"}</span>
                <span className="user-list__side">{formatEventDate(item.service_date)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="user-detail__muted">
            No meals or hospitality have been announced for this event yet.
          </p>
        )
      }
    </LazyTab>
  );
}

export function AccommodationTab({ cache, onAuthError, onGoToRegistration }) {
  return (
    <LazyTab cache={cache} resource="accommodation" onAuthError={onAuthError}>
      {(data) => {
        if (!data.registered) {
          return (
            <p className="user-detail__muted">
              You are not registered for this event, so there is no accommodation for you.{" "}
              <button className="user-linkbutton" type="button" onClick={onGoToRegistration}>
                Go to registration
              </button>
            </p>
          );
        }
        if (!data.accommodation) {
          return (
            <p className="user-detail__muted">
              No accommodation has been assigned to you for this event.
              {data.registration_status !== "Confirmed" &&
                " Accommodation is usually assigned after your registration is confirmed."}
            </p>
          );
        }
        const stay = data.accommodation;
        return (
          <dl className="user-detail__facts">
            <div>
              <dt>Building</dt>
              <dd>{stay.building_name || "To be announced"}</dd>
            </div>
            <div>
              <dt>Room</dt>
              <dd>{stay.room_number || "To be announced"}</dd>
            </div>
            <div>
              <dt>Check-in</dt>
              <dd>{formatEventDate(stay.check_in_date)}</dd>
            </div>
            <div>
              <dt>Check-out</dt>
              <dd>{formatEventDate(stay.check_out_date)}</dd>
            </div>
          </dl>
        );
      }}
    </LazyTab>
  );
}

function ResultsView({ data }) {
  const evaluation = data.my_evaluation;
  const report = data.report;

  return (
    <div className="user-results">
      <section aria-labelledby="my-evaluation-heading">
        <h4 id="my-evaluation-heading" className="user-subheading">My evaluation</h4>
        {evaluation ? (
          <dl className="user-detail__facts">
            <div>
              <dt>Score</dt>
              <dd>{evaluation.score ?? "Not scored"}</dd>
            </div>
            <div>
              <dt>Feedback rating</dt>
              <dd>{evaluation.feedback_rating ?? "Not rated"}</dd>
            </div>
            <div>
              <dt>Certificate</dt>
              <dd>{evaluation.certificate_issued ? "Issued" : "Not issued"}</dd>
            </div>
          </dl>
        ) : (
          <p className="user-detail__muted">
            {data.registered
              ? "Your evaluation has not been recorded yet."
              : "You did not register for this event, so there is no evaluation for you."}
          </p>
        )}
      </section>

      <section aria-labelledby="winners-heading">
        <h4 id="winners-heading" className="user-subheading">Winners</h4>
        {data.winners?.length ? (
          <ol className="user-list">
            {data.winners.map((winner) => (
              <li
                key={`${winner.position}-${winner.name}`}
                className={`user-list__row${winner.is_me ? " user-list__row--me" : ""}`}
              >
                <span className="user-list__main">
                  <strong>{ordinal(winner.position)}</strong> {winner.name}
                  {winner.is_me && <span className="user-registered user-list__you">You</span>}
                </span>
                <span className="user-list__side">
                  {[winner.prize, winner.remarks].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="user-detail__muted">Winners have not been announced yet.</p>
        )}
      </section>

      <section aria-labelledby="report-heading">
        <h4 id="report-heading" className="user-subheading">Event report</h4>
        {report ? (
          <>
            {report.total_attendees != null && (
              <p className="user-detail__muted">
                Total attendees: <strong>{report.total_attendees}</strong>
                {report.report_date ? ` · Report dated ${formatEventDate(report.report_date)}` : ""}
              </p>
            )}
            <p className="user-detail__description">
              {report.summary_text || "No summary has been written for this event."}
            </p>
            {report.photos?.length > 0 && (
              <div className="user-photos" aria-label="Event photographs">
                {report.photos.map((url, index) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={url}
                      alt={`Event photograph ${index + 1}`}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  </a>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="user-detail__muted">The event report has not been published yet.</p>
        )}
      </section>
    </div>
  );
}

export function ResultsTab({ cache, onAuthError }) {
  return (
    <LazyTab cache={cache} resource="results" onAuthError={onAuthError}>
      {(data) => <ResultsView data={data} />}
    </LazyTab>
  );
}

export function ScheduleTab({ sessions }) {
  return sessions?.length ? (
    <ol className="user-schedule">
      {sessions.map((session) => (
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
  );
}
