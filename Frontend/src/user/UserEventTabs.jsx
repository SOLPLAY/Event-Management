import { useEffect, useState } from "react";
import { formatEventDate } from "../eventApi";
import { formatDateTime, ordinal, requestUserApi } from "./userApi";

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

  function refresh() {
    cache.invalidate(resource);
    setState({ loading: true, data: null, error: "" });
    setReloadKey((key) => key + 1);
  }

  if (state.loading) return <p className="event-list-message">Loading…</p>;

  if (state.error) {
    return (
      <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
        {state.error}
        <button
          className="nitt-admin__action"
          type="button"
          onClick={refresh}
        >
          Retry
        </button>
      </p>
    );
  }

  return children(state.data, refresh);
}

function nextLocalDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

function AccommodationContent({
  cache,
  data,
  event,
  onAuthError,
  onGoToRegistration,
}) {
  const [accommodationData, setAccommodationData] = useState(data);
  const [dates, setDates] = useState({
    check_in_date: event.start_date ?? "",
    check_out_date:
      event.start_date === event.end_date && event.end_date
        ? nextLocalDate(event.end_date)
        : event.end_date ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const accommodation = accommodationData.accommodation;
  const requestStatus = accommodation?.request_status;

  async function submitRequest(submitEvent) {
    submitEvent.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await requestUserApi(`/events/${event.event_id}/accommodation`, {
        method: "POST",
        body: JSON.stringify(dates),
      });
      if (!result.data || typeof result.data !== "object") {
        throw new Error("The server response did not contain the accommodation request.");
      }
      setAccommodationData(result.data);
      cache.invalidate("accommodation");
      setNotice("Your accommodation request was submitted for approval.");
    } catch (requestError) {
      if (requestError.status === 401) {
        onAuthError();
        return;
      }
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {error && <p className="user-notice user-notice--error" role="alert">{error}</p>}
      {notice && <p className="user-notice user-notice--success" role="status">{notice}</p>}
      {!accommodationData.registered ? (
        <p className="user-detail__muted">
          You are not registered for this event, so you cannot request accommodation yet.{" "}
          <button className="user-linkbutton" type="button" onClick={onGoToRegistration}>
            Go to registration
          </button>
        </p>
      ) : requestStatus === "Approved" ? (
        <>
          <p className="accommodation-request-status accommodation-request-status--approved">
            Accommodation approved
          </p>
          <dl className="user-detail__facts">
            <div>
              <dt>Building</dt>
              <dd>{accommodation.building_name || "To be announced"}</dd>
            </div>
            <div>
              <dt>Room</dt>
              <dd>{accommodation.room_number || "To be announced"}</dd>
            </div>
            <div>
              <dt>Check-in</dt>
              <dd>{formatEventDate(accommodation.check_in_date)}</dd>
            </div>
            <div>
              <dt>Check-out</dt>
              <dd>{formatEventDate(accommodation.check_out_date)}</dd>
            </div>
          </dl>
        </>
      ) : requestStatus === "Pending" ? (
        <>
          <p className="accommodation-request-status accommodation-request-status--pending">
            Your accommodation request is awaiting organizer review.
          </p>
          <dl className="user-detail__facts">
            <div>
              <dt>Check-in</dt>
              <dd>{formatEventDate(accommodation.check_in_date)}</dd>
            </div>
            <div>
              <dt>Check-out</dt>
              <dd>{formatEventDate(accommodation.check_out_date)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          {requestStatus === "Rejected" && (
            <p className="accommodation-request-status accommodation-request-status--rejected">
              Your previous accommodation request was rejected. You may submit another request.
            </p>
          )}
          {accommodationData.registration_status !== "Confirmed" ? (
            <p className="user-detail__muted">
              Your event registration must be confirmed before you can request accommodation.{" "}
              <button className="user-linkbutton" type="button" onClick={onGoToRegistration}>
                Go to registration
              </button>
            </p>
          ) : (
            <form className="accommodation-request-form" onSubmit={submitRequest}>
              <p className="user-detail__muted">
                Choose your stay dates. The stay must overlap the event dates and will be
                reviewed based on room availability.
              </p>
              <label className="nitt-admin__field">
                <span>Check-in</span>
                <input
                  type="date"
                  max={event.end_date || undefined}
                  value={dates.check_in_date}
                  onChange={(changeEvent) =>
                    setDates((current) => ({
                      ...current,
                      check_in_date: changeEvent.target.value,
                    }))
                  }
                  required
                  disabled={saving}
                />
              </label>
              <label className="nitt-admin__field">
                <span>Check-out</span>
                <input
                  type="date"
                  min={
                    dates.check_in_date
                      ? nextLocalDate(dates.check_in_date)
                      : event.start_date || undefined
                  }
                  value={dates.check_out_date}
                  onChange={(changeEvent) =>
                    setDates((current) => ({
                      ...current,
                      check_out_date: changeEvent.target.value,
                    }))
                  }
                  required
                  disabled={saving}
                />
              </label>
              <div className="accommodation-request-form__actions">
                <button
                  className="nitt-admin__button nitt-admin__button--primary"
                  type="submit"
                  disabled={saving || !dates.check_in_date || !dates.check_out_date}
                >
                  {saving ? "Submitting…" : "Request accommodation"}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </>
  );
}

export function AccommodationTab({
  cache,
  event,
  onAuthError,
  onGoToRegistration,
}) {
  return (
    <LazyTab cache={cache} resource="accommodation" onAuthError={onAuthError}>
      {(data) => (
        <AccommodationContent
          cache={cache}
          data={data}
          event={event}
          onAuthError={onAuthError}
          onGoToRegistration={onGoToRegistration}
        />
      )}
    </LazyTab>
  );
}

function ResultsView({ data, onRefresh }) {
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
        ) : !data.released ? (
          <div>
            <p className="user-detail__muted">
              Your evaluation and event scores will appear after the organizer publishes them.
            </p>
            <button
              className="nitt-admin__button nitt-admin__button--quiet"
              type="button"
              onClick={onRefresh}
            >
              Check again
            </button>
          </div>
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
      {(data, onRefresh) => (
        <ResultsView data={data} onRefresh={onRefresh} />
      )}
    </LazyTab>
  );
}

function EvaluationScoresView({ data, onRefresh }) {
  if (!data.released) {
    return (
      <section>
        <p className="user-detail__muted">
          The organizer has not published participant scores yet. Please check again later.
        </p>
        <button
          className="nitt-admin__button nitt-admin__button--quiet"
          type="button"
          onClick={onRefresh}
        >
          Check again
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby="evaluation-scores-heading">
      <div className="user-score-heading">
        <h4 id="evaluation-scores-heading" className="user-subheading">
          Participant scores
        </h4>
        <button
          className="nitt-admin__button nitt-admin__button--quiet"
          type="button"
          onClick={onRefresh}
        >
          Refresh scores
        </button>
      </div>
      {data.scores?.length ? (
        <div className="registration-table-wrap">
          <table className="registration-table">
            <thead>
              <tr>
                <th scope="col">Participant</th>
                <th scope="col">Score</th>
              </tr>
            </thead>
            <tbody>
              {data.scores.map((record, index) => (
                <tr
                  key={`${record.name}-${index}`}
                  className={record.is_me ? "user-score-row--me" : undefined}
                >
                  <td>
                    {record.name}
                    {record.is_me && (
                      <span className="user-registered user-list__you">You</span>
                    )}
                  </td>
                  <td>{record.score ?? "Not scored"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="user-detail__muted">
          No participant scores have been recorded for this event.
        </p>
      )}
    </section>
  );
}

export function EvaluationScoresTab({ cache, onAuthError }) {
  return (
    <LazyTab cache={cache} resource="evaluation-scores" onAuthError={onAuthError}>
      {(data, onRefresh) => (
        <EvaluationScoresView data={data} onRefresh={onRefresh} />
      )}
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
