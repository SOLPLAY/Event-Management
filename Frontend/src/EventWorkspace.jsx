import { formatEventDate } from "./eventApi";
import { EVENT_WORKSPACE_SECTIONS } from "./eventWorkspaceSections";

const placeholderCopy = {
  accommodation: "Manage accommodation planning and arrangements for this event.",
  advertisement: "Plan and manage event announcements and promotional materials.",
  evaluation: "Coordinate event evaluation forms, feedback, and results.",
  statistics: "Student registrations, participation, and other event metrics will appear here.",
  hospitality: "Coordinate hospitality services and attendee requirements.",
  report: "Prepare and review the event report.",
};

export default function EventWorkspace({ event, section }) {
  const activeSection =
    EVENT_WORKSPACE_SECTIONS.find((item) => item.id === section)?.id ?? "overview";

  if (activeSection !== "overview") {
    const page = EVENT_WORKSPACE_SECTIONS.find((item) => item.id === activeSection);
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
