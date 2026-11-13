import { formatEventDate } from "../eventApi";
import { formatFee } from "./userApi";

export default function UserEventCard({ event, onOpen }) {
  const registration = event.my_registration;

  return (
    <article className="event-card user-event-card">
      <div className="event-card__topline">
        <span className={`user-phase user-phase--${event.phase.toLowerCase()}`}>
          {event.phase}
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
        <div>
          <dt>Fee</dt>
          <dd>{formatFee(event.fee)}</dd>
        </div>
        {event.organizers?.length > 0 && (
          <div>
            <dt>Organised by</dt>
            <dd>{event.organizers.join(", ")}</dd>
          </div>
        )}
      </dl>
      <div className="event-card__actions">
        {registration && (
          <span className="user-registered">Registered · {registration.status}</span>
        )}
        <button
          className="nitt-admin__button nitt-admin__button--primary"
          type="button"
          onClick={() => onOpen(event.event_id)}
        >
          View details
        </button>
      </div>
    </article>
  );
}
