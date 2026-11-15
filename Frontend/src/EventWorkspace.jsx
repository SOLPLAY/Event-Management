import { useEffect, useState } from "react";
import { formatEventDate, requestEventApi } from "./eventApi";
import { formatDateTime } from "./user/userApi";
import { EVENT_WORKSPACE_SECTIONS } from "./eventWorkspaceSections";

const placeholderCopy = {
  accommodation: "Manage accommodation planning and arrangements for this event.",
  advertisement: "Plan and manage event announcements and promotional materials.",
  evaluation: "Coordinate event evaluation forms, feedback, and results.",
  hospitality: "Coordinate hospitality services and attendee requirements.",
  report: "Prepare and review the event report.",
};

function formatRegistrationFee(value) {
  const fee = Number(value ?? 0);
  if (fee <= 0) return "Free";
  return `₹${fee.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function safeExternalUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export default function EventWorkspace({ event, section }) {
  const activeSection =
    EVENT_WORKSPACE_SECTIONS.find((item) => item.id === section)?.id ?? "overview";
  const [hospitalityState, setHospitalityState] = useState({
    eventId: null,
    records: [],
    error: "",
  });
  const hospitalityLoading = hospitalityState.eventId !== event.event_id;
  const [registrationsState, setRegistrationsState] = useState({
    eventId: null,
    records: [],
    eventFee: 0,
    error: "",
  });
  const registrationsLoading = registrationsState.eventId !== event.event_id;
  const [sessionsState, setSessionsState] = useState({
    eventId: null,
    records: [],
    error: "",
  });
  const sessionsLoading = sessionsState.eventId !== event.event_id;
  const [accommodationState, setAccommodationState] = useState({
    eventId: null,
    records: [],
    error: "",
  });
  const accommodationLoading = accommodationState.eventId !== event.event_id;
  const [advertisementsState, setAdvertisementsState] = useState({
    eventId: null,
    records: [],
    error: "",
  });
  const advertisementsLoading = advertisementsState.eventId !== event.event_id;
  const [evaluationsState, setEvaluationsState] = useState({
    eventId: null,
    records: [],
    error: "",
  });
  const evaluationsLoading = evaluationsState.eventId !== event.event_id;
  const [reportState, setReportState] = useState({
    eventId: null,
    report: null,
    error: "",
  });
  const reportLoading = reportState.eventId !== event.event_id;

  useEffect(() => {
    if (activeSection !== "hospitality") return undefined;

    let active = true;
    requestEventApi(`/organizer/events/${event.event_id}/hospitality`)
      .then((result) => {
        if (!Array.isArray(result.data)) {
          throw new Error("The server response did not contain hospitality records.");
        }
        if (active) {
          setHospitalityState({
            eventId: event.event_id,
            records: result.data,
            error: "",
          });
        }
      })
      .catch((requestError) => {
        if (active) {
          setHospitalityState({
            eventId: event.event_id,
            records: [],
            error: requestError.message,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [activeSection, event.event_id]);

  useEffect(() => {
    if (activeSection !== "registrations") return undefined;

    let active = true;
    requestEventApi(`/organizer/events/${event.event_id}/registrations`)
      .then((result) => {
        if (!Array.isArray(result.data)) {
          throw new Error("The server response did not contain registration records.");
        }
        if (active) {
          setRegistrationsState({
            eventId: event.event_id,
            records: result.data,
            eventFee: result.event_fee,
            error: "",
          });
        }
      })
      .catch((requestError) => {
        if (active) {
          setRegistrationsState({
            eventId: event.event_id,
            records: [],
            eventFee: 0,
            error: requestError.message,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [activeSection, event.event_id]);

  useEffect(() => {
    if (activeSection !== "overview") return undefined;

    let active = true;
    requestEventApi(`/organizer/events/${event.event_id}/sessions`)
      .then((result) => {
        if (!Array.isArray(result.data)) {
          throw new Error("The server response did not contain session records.");
        }
        if (active) {
          setSessionsState({
            eventId: event.event_id,
            records: result.data,
            error: "",
          });
        }
      })
      .catch((requestError) => {
        if (active) {
          setSessionsState({
            eventId: event.event_id,
            records: [],
            error: requestError.message,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [activeSection, event.event_id]);

  useEffect(() => {
    if (activeSection !== "accommodation") return undefined;

    let active = true;
    requestEventApi(`/organizer/events/${event.event_id}/accommodation`)
      .then((result) => {
        if (!Array.isArray(result.data)) {
          throw new Error("The server response did not contain accommodation records.");
        }
        if (active) {
          setAccommodationState({
            eventId: event.event_id,
            records: result.data,
            error: "",
          });
        }
      })
      .catch((requestError) => {
        if (active) {
          setAccommodationState({
            eventId: event.event_id,
            records: [],
            error: requestError.message,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [activeSection, event.event_id]);

  useEffect(() => {
    if (activeSection !== "advertisement") return undefined;

    let active = true;
    requestEventApi(`/organizer/events/${event.event_id}/advertisements`)
      .then((result) => {
        if (!Array.isArray(result.data)) {
          throw new Error("The server response did not contain advertisement records.");
        }
        if (active) {
          setAdvertisementsState({
            eventId: event.event_id,
            records: result.data,
            error: "",
          });
        }
      })
      .catch((requestError) => {
        if (active) {
          setAdvertisementsState({
            eventId: event.event_id,
            records: [],
            error: requestError.message,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [activeSection, event.event_id]);

  useEffect(() => {
    if (activeSection !== "evaluation") return undefined;

    let active = true;
    requestEventApi(`/organizer/events/${event.event_id}/evaluations`)
      .then((result) => {
        if (!Array.isArray(result.data)) {
          throw new Error("The server response did not contain evaluation records.");
        }
        if (active) {
          setEvaluationsState({
            eventId: event.event_id,
            records: result.data,
            error: "",
          });
        }
      })
      .catch((requestError) => {
        if (active) {
          setEvaluationsState({
            eventId: event.event_id,
            records: [],
            error: requestError.message,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [activeSection, event.event_id]);

  useEffect(() => {
    if (activeSection !== "report") return undefined;

    let active = true;
    requestEventApi(`/organizer/events/${event.event_id}/report`)
      .then((result) => {
        if (result.data !== null && (typeof result.data !== "object" || Array.isArray(result.data))) {
          throw new Error("The server response did not contain a valid event report.");
        }
        if (active) {
          setReportState({
            eventId: event.event_id,
            report: result.data,
            error: "",
          });
        }
      })
      .catch((requestError) => {
        if (active) {
          setReportState({
            eventId: event.event_id,
            report: null,
            error: requestError.message,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [activeSection, event.event_id]);

  if (activeSection !== "overview") {
    const page = EVENT_WORKSPACE_SECTIONS.find((item) => item.id === activeSection);
    if (activeSection === "report") {
      const report = reportState.report;
      const photographsUrl = safeExternalUrl(report?.photographs_url);
      return (
        <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
          <div className="event-workspace-panel__eyebrow">{event.name}</div>
          <h2 id="event-workspace-heading">{page.label}</h2>
          <p>Event summary, attendance, and photographs.</p>
          {reportState.error ? (
            <p className="hospitality-message hospitality-message--error" role="alert">
              {reportState.error}
            </p>
          ) : reportLoading ? (
            <p className="hospitality-message" role="status">Loading event report…</p>
          ) : report ? (
            <dl className="event-overview-details event-report-details">
              <div>
                <dt>Report date</dt>
                <dd>{formatEventDate(report.report_date)}</dd>
              </div>
              <div>
                <dt>Total attendees</dt>
                <dd>{report.total_attendees ?? "Not provided"}</dd>
              </div>
              <div className="event-overview-details__description">
                <dt>Summary</dt>
                <dd>{report.summary_text || "No summary provided."}</dd>
              </div>
              <div className="event-overview-details__description">
                <dt>Photographs</dt>
                <dd>
                  {photographsUrl ? (
                    <a href={photographsUrl} target="_blank" rel="noopener noreferrer">
                      View event photographs
                    </a>
                  ) : report.photographs_url ? (
                    "The photograph URL is invalid."
                  ) : (
                    "Not provided"
                  )}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="hospitality-message">No report has been added for this event yet.</p>
          )}
        </section>
      );
    }

    if (activeSection === "evaluation") {
      return (
        <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
          <div className="event-workspace-panel__eyebrow">{event.name}</div>
          <h2 id="event-workspace-heading">{page.label}</h2>
          <p>Participant scores, feedback ratings, and certificate status.</p>
          {evaluationsState.error ? (
            <p className="hospitality-message hospitality-message--error" role="alert">
              {evaluationsState.error}
            </p>
          ) : evaluationsLoading ? (
            <p className="hospitality-message" role="status">Loading evaluation details…</p>
          ) : evaluationsState.records.length ? (
            <div className="registration-table-wrap">
              <table className="registration-table">
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    <th scope="col">Score</th>
                    <th scope="col">Feedback rating</th>
                    <th scope="col">Certificate</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluationsState.records.map((record) => (
                    <tr key={record.evaluation_id}>
                      <td>{record.person_name}</td>
                      <td>{record.score ?? "Not scored"}</td>
                      <td>{record.feedback_rating ?? "Not rated"}</td>
                      <td>
                        {record.certificate_issued === true
                          ? "Issued"
                          : record.certificate_issued === false
                            ? "Not issued"
                            : "Not recorded"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="hospitality-message">
              No evaluation records have been added for this event.
            </p>
          )}
        </section>
      );
    }

    if (activeSection === "advertisement") {
      return (
        <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
          <div className="event-workspace-panel__eyebrow">{event.name}</div>
          <h2 id="event-workspace-heading">{page.label}</h2>
          <p>Promotion platforms, target audiences, and planned publish dates.</p>
          {advertisementsState.error ? (
            <p className="hospitality-message hospitality-message--error" role="alert">
              {advertisementsState.error}
            </p>
          ) : advertisementsLoading ? (
            <p className="hospitality-message" role="status">Loading advertisement details…</p>
          ) : advertisementsState.records.length ? (
            <div className="hospitality-grid">
              {advertisementsState.records.map((advertisement) => (
                <article className="hospitality-card" key={advertisement.ad_id}>
                  <dl className="hospitality-card__details">
                    <div>
                      <dt>Platform</dt>
                      <dd>{advertisement.platform}</dd>
                    </div>
                    <div>
                      <dt>Target audience</dt>
                      <dd>{advertisement.target_audience || "Not specified"}</dd>
                    </div>
                    <div>
                      <dt>Publish date</dt>
                      <dd>{formatEventDate(advertisement.publish_date)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          ) : (
            <p className="hospitality-message">
              No advertisements have been added for this event.
            </p>
          )}
        </section>
      );
    }

    if (activeSection === "accommodation") {
      return (
        <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
          <div className="event-workspace-panel__eyebrow">{event.name}</div>
          <h2 id="event-workspace-heading">{page.label}</h2>
          <p>Room assignments and stay dates for students registered for this event.</p>
          {accommodationState.error ? (
            <p className="hospitality-message hospitality-message--error" role="alert">
              {accommodationState.error}
            </p>
          ) : accommodationLoading ? (
            <p className="hospitality-message" role="status">Loading accommodation details…</p>
          ) : accommodationState.records.length ? (
            <div className="hospitality-grid">
              {accommodationState.records.map((record) => (
                <article className="hospitality-card" key={record.accommodation_id}>
                  <dl className="hospitality-card__details">
                    <div>
                      <dt>Student</dt>
                      <dd>{record.person_name}</dd>
                    </div>
                    <div>
                      <dt>Building</dt>
                      <dd>{record.building_name}</dd>
                    </div>
                    <div>
                      <dt>Room</dt>
                      <dd>{record.room_number || "Not assigned"}</dd>
                    </div>
                    <div>
                      <dt>Check-in</dt>
                      <dd>{formatDateTime(record.check_in_date)}</dd>
                    </div>
                    <div>
                      <dt>Check-out</dt>
                      <dd>{formatDateTime(record.check_out_date)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          ) : (
            <p className="hospitality-message">
              No accommodation assignments have been added for this event.
            </p>
          )}
        </section>
      );
    }

    if (activeSection === "registrations") {
      return (
        <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
          <div className="event-workspace-panel__eyebrow">{event.name}</div>
          <h2 id="event-workspace-heading">{page.label}</h2>
          <p>Students registered for this event and their payment details.</p>
          {registrationsState.error ? (
            <p className="hospitality-message hospitality-message--error" role="alert">
              {registrationsState.error}
            </p>
          ) : registrationsLoading ? (
            <p className="hospitality-message" role="status">Loading student registrations…</p>
          ) : registrationsState.records.length ? (
            <div className="registration-table-wrap">
              <table className="registration-table">
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    <th scope="col">Registration date</th>
                    <th scope="col">Status</th>
                    <th scope="col">Registration fee</th>
                  </tr>
                </thead>
                <tbody>
                  {registrationsState.records.map((record) => (
                    <tr key={record.registration_id}>
                      <td>{record.person_name}</td>
                      <td>{formatEventDate(record.registration_date)}</td>
                      <td>{record.status}</td>
                      <td>{formatRegistrationFee(registrationsState.eventFee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="hospitality-message">
              No students have registered for this event yet.
            </p>
          )}
        </section>
      );
    }

    if (activeSection === "hospitality") {
      return (
        <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
          <div className="event-workspace-panel__eyebrow">{event.name}</div>
          <h2 id="event-workspace-heading">{page.label}</h2>
          <p>Hospitality arrangements and meal service details for this event.</p>
          {hospitalityState.error ? (
            <p className="hospitality-message hospitality-message--error" role="alert">
              {hospitalityState.error}
            </p>
          ) : hospitalityLoading ? (
            <p className="hospitality-message" role="status">Loading hospitality details…</p>
          ) : hospitalityState.records.length ? (
            <div className="hospitality-grid">
              {hospitalityState.records.map((record) => (
                <article className="hospitality-card" key={record.hospitality_id}>
                  <dl className="hospitality-card__details">
                    <div>
                      <dt>Meal type</dt>
                      <dd>{record.meal_type}</dd>
                    </div>
                    <div>
                      <dt>Service date</dt>
                      <dd>{formatEventDate(record.service_date)}</dd>
                    </div>
                    <div>
                      <dt>Vendor</dt>
                      <dd>{record.vendor_name || "Not provided"}</dd>
                    </div>
                    <div>
                      <dt>Head count</dt>
                      <dd>{record.head_count ?? "Not provided"}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          ) : (
            <p className="hospitality-message">
              No hospitality details have been added for this event.
            </p>
          )}
        </section>
      );
    }

    return (
      <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
        <div className="event-workspace-panel__eyebrow">{event.name}</div>
        <h2 id="event-workspace-heading">{page.label}</h2>
        <p>{placeholderCopy[activeSection]}</p>
        <div className="event-workspace-placeholder" aria-live="polite">
          This page is ready for its event-management features.
        </div>
      </section>
    );
  }

  return (
    <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
      <div className="event-workspace-panel__eyebrow">Event overview</div>
      <div className="event-workspace-panel__title-row">
        <h2 id="event-workspace-heading">{event.name}</h2>
        {event.event_status && (
          <span className={`event-card__status event-card__status--${event.event_status.toLowerCase()}`}>
            {event.event_status}
          </span>
        )}
      </div>
      <dl className="event-overview-details">
        <div>
          <dt>Event type</dt>
          <dd>{event.type || "Not set"}</dd>
        </div>
        <div>
          <dt>Start date</dt>
          <dd>{formatEventDate(event.start_date)}</dd>
        </div>
        <div>
          <dt>End date</dt>
          <dd>{formatEventDate(event.end_date)}</dd>
        </div>
        <div className="event-overview-details__description">
          <dt>Description</dt>
          <dd>{event.description || "No description provided."}</dd>
        </div>
      </dl>
      <section className="event-session-section" aria-labelledby="event-session-heading">
        <h3 id="event-session-heading">Sessions</h3>
        {sessionsState.error ? (
          <p className="hospitality-message hospitality-message--error" role="alert">
            {sessionsState.error}
          </p>
        ) : sessionsLoading ? (
          <p className="hospitality-message" role="status">Loading session details…</p>
        ) : sessionsState.records.length ? (
          <ol className="event-session-list">
            {sessionsState.records.map((session) => (
              <li className="event-session-card" key={session.session_id}>
                <div className="event-session-card__time">
                  {formatDateTime(session.start_time)} – {formatDateTime(session.end_time)}
                </div>
                <h4>{session.session_title}</h4>
                <p>
                  {[session.speaker_name, session.venue].filter(Boolean).join(" · ") ||
                    "Speaker and venue not provided"}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="hospitality-message">No sessions have been added to this event yet.</p>
        )}
      </section>
    </section>
  );
}
