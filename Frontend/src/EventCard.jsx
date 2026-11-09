import { formatEventDate } from "./eventApi";

function statusClass(status) {
  return status.toLowerCase().replaceAll(" ", "-");
}

export default function EventCard({
  event,
  mode,
  busy,
  onDecision,
  onView,
  onUpdate,
  onDelete,
  onPublish,
}) {
  const pending = event.event_status === "Pending";
  const locked = ["Published", "Completed"].includes(event.event_status);
  const canUpdate = ["Pending", "Rejected"].includes(event.event_status);

  return (
    <article className="event-card">
      <div className="event-card__topline">
        <span className={`event-card__status event-card__status--${statusClass(event.event_status)}`}>
          {event.event_status}
        </span>
        <span className="event-card__type">{event.type || "Event"}</span>
      </div>
      <h2 className="event-card__title">{event.name}</h2>
      {event.description && <p className="event-card__description">{event.description}</p>}
      <dl className="event-card__details">
        <div>
          <dt>Start date</dt>
          <dd>{formatEventDate(event.start_date)}</dd>
        </div>
        <div>
          <dt>End date</dt>
          <dd>{formatEventDate(event.end_date)}</dd>
        </div>
        {mode === "super-admin" && (
          <div>
            <dt>Organizer</dt>
            <dd>{event.organizers?.join(", ") || event.created_by || "Unknown"}</dd>
          </div>
        )}
      </dl>
      {mode === "super-admin" && pending && (
        <div className="event-card__actions">
          <button
            className="nitt-admin__button nitt-admin__button--primary"
            type="button"
            disabled={busy}
            onClick={() => onDecision(event.event_id, "Approved")}
          >
            Approve
          </button>
          <button
            className="nitt-admin__button nitt-admin__button--danger"
            type="button"
            disabled={busy}
            onClick={() => onDecision(event.event_id, "Rejected")}
          >
            Reject
          </button>
        </div>
      )}
      {mode === "organizer" && (
        <div className="event-card__actions">
          <button
            className="nitt-admin__button nitt-admin__button--quiet"
            type="button"
            disabled={busy}
            onClick={() => onView(event)}
          >
            View event
          </button>
          {canUpdate && (
            <button
              className="nitt-admin__button nitt-admin__button--quiet"
              type="button"
              disabled={busy}
              onClick={() => onUpdate(event)}
            >
              Update
            </button>
          )}
          {!locked && (
            <>
              <button
                className="nitt-admin__button nitt-admin__button--danger"
                type="button"
                disabled={busy}
                onClick={() => onDelete(event)}
              >
                Delete
              </button>
              <button
                className="nitt-admin__button nitt-admin__button--primary"
                type="button"
                disabled={busy || event.event_status !== "Approved"}
                title={event.event_status !== "Approved" ? "Available after approval" : undefined}
                onClick={() => onPublish(event.event_id)}
              >
                Publish
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
