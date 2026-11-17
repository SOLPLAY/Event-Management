import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { formatEventDate, requestEventApi } from "./eventApi";
import { EVENT_WORKSPACE_SECTIONS } from "./eventWorkspaceSections";
import EventAccommodation from "./EventAccommodation";
import EventAdvertisement from "./EventAdvertisement";
import EventEvaluationSection from "./EventEvaluationSection";
import EventHospitality from "./EventHospitality";
import EventPayments from "./EventPayments";
import EventReport from "./EventReport";
import EventSessions from "./EventSessions";

const placeholderCopy = {
  accommodation: "Manage accommodation planning and arrangements for this event.",
  advertisement: "Plan and manage event announcements and promotional materials.",
  evaluation: "Coordinate event evaluation forms, feedback, and results.",
  hospitality: "Coordinate hospitality services and attendee requirements.",
  payments: "Manage payment account details and verify submitted payments.",
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

export default function EventWorkspace({ event, section }) {
  const location = useLocation();
  const navigate = useNavigate();
  const activeSection =
    EVENT_WORKSPACE_SECTIONS.find((item) => item.id === section)?.id ?? "overview";
  const [registrationsState, setRegistrationsState] = useState({
    eventId: null,
    records: [],
    eventFee: 0,
    error: "",
  });
  const registrationsLoading = registrationsState.eventId !== event.event_id;
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

  if (activeSection !== "overview") {
    const page = EVENT_WORKSPACE_SECTIONS.find((item) => item.id === activeSection);
    if (activeSection === "accommodation") {
      return <EventAccommodation event={event} />;
    }

    if (activeSection === "sessions") {
      return <EventSessions event={event} />;
    }

    if (activeSection === "hospitality") {
      return <EventHospitality key={event.event_id} event={event} />;
    }

    if (activeSection === "report") {
      return <EventReport key={event.event_id} event={event} />;
    }

    if (activeSection === "evaluation") {
      return <EventEvaluationSection key={event.event_id} event={event} />;
    }

    if (activeSection === "payments") {
      return <EventPayments key={event.event_id} event={event} />;
    }

    if (activeSection === "advertisement") {
      return <EventAdvertisement key={event.event_id} event={event} />;
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
                    <th scope="col">Evaluation</th>
                  </tr>
                </thead>
                <tbody>
                  {registrationsState.records.map((record) => (
                    <tr key={record.registration_id}>
                      <td>{record.person_name}</td>
                      <td>{formatEventDate(record.registration_date)}</td>
                      <td>{record.status}</td>
                      <td>{formatRegistrationFee(registrationsState.eventFee)}</td>
                      <td>
                        <button
                          className="nitt-admin__button nitt-admin__button--quiet"
                          type="button"
                          onClick={() =>
                            navigate(
                              `${location.pathname}?tab=workspace&event_id=${event.event_id}&section=evaluation&registration_id=${record.registration_id}`
                            )
                          }
                        >
                          Evaluate
                        </button>
                      </td>
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
    </section>
  );
}
