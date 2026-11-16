import { useEffect, useState } from "react";
import { formatEventDate, requestEventApi } from "./eventApi";

export default function EventAccommodation({ event }) {
  const [state, setState] = useState({
    eventId: null,
    records: [],
    activeRoomCount: null,
    error: "",
  });
  const [selectedRooms, setSelectedRooms] = useState({});
  const [busyRequestId, setBusyRequestId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loading = state.eventId !== event.event_id;

  useEffect(() => {
    let active = true;

    requestEventApi(`/organizer/events/${event.event_id}/accommodation`)
      .then((result) => {
        if (!Array.isArray(result.data)) {
          throw new Error("The server response did not contain accommodation requests.");
        }
        if (active) {
          setState({
            eventId: event.event_id,
            records: result.data,
            activeRoomCount: result.active_room_count ?? null,
            error: "",
          });
        }
      })
      .catch((requestError) => {
        if (active) {
          setState({
            eventId: event.event_id,
            records: [],
            activeRoomCount: null,
            error: requestError.message,
          });
        }
      });

    return () => {
      active = false;
    };
  }, [event.event_id]);

  async function refreshRequests() {
    try {
      const result = await requestEventApi(`/organizer/events/${event.event_id}/accommodation`);
      if (!Array.isArray(result.data)) {
        throw new Error("The server response did not contain accommodation requests.");
      }
      setState({
        eventId: event.event_id,
        records: result.data,
        activeRoomCount: result.active_room_count ?? null,
        error: "",
      });
    } catch (requestError) {
      setState({
        eventId: event.event_id,
        records: [],
        activeRoomCount: null,
        error: requestError.message,
      });
    }
  }

  async function decideRequest(record, decision) {
    const action = decision === "approve" ? "approve" : "reject";
    if (
      decision === "reject" &&
      !window.confirm(`Reject the accommodation request from ${record.person_name}?`)
    ) {
      return;
    }

    const availableRooms = record.available_rooms ?? [];
    const selectedRoomId = selectedRooms[record.accommodation_id];
    const roomIsAvailable = availableRooms.some(
      (room) => String(room.room_id) === String(selectedRoomId)
    );
    const roomId = roomIsAvailable ? selectedRoomId : availableRooms[0]?.room_id;
    if (action === "approve" && !roomId) return;

    setBusyRequestId(record.accommodation_id);
    setError("");
    setNotice("");
    try {
      await requestEventApi(
        `/organizer/events/${event.event_id}/accommodation/${record.accommodation_id}/${action}`,
        {
          method: "POST",
          ...(action === "approve"
            ? { body: JSON.stringify({ room_id: Number(roomId) }) }
            : {}),
        }
      );
      setNotice(
        action === "approve"
          ? `Accommodation approved for ${record.person_name}.`
          : `Accommodation request rejected for ${record.person_name}.`
      );
      await refreshRequests();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyRequestId(null);
    }
  }

  return (
    <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
      <div className="event-workspace-panel__eyebrow">{event.name}</div>
      <h2 id="event-workspace-heading">Accommodation requests</h2>
      <p>Review requested stay dates, check room availability, and approve or reject requests.</p>

      {error && (
        <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
          {error}
        </p>
      )}
      {state.error && (
        <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
          {state.error}
        </p>
      )}
      {notice && <p className="nitt-admin__notice event-notice" role="status">{notice}</p>}

      {loading ? (
        <p className="hospitality-message" role="status">Loading accommodation requests…</p>
      ) : state.records.length ? (
        <div className="hospitality-grid">
          {state.records.map((record) => {
            const availableRooms = record.available_rooms ?? [];
            const chosenRoom = selectedRooms[record.accommodation_id];
            const selectedRoomId = availableRooms.some(
              (room) => String(room.room_id) === String(chosenRoom)
            )
              ? String(chosenRoom)
              : availableRooms.length
                ? String(availableRooms[0].room_id)
                : "";
            const requestStatus = record.request_status || "Pending";
            return (
              <article className="hospitality-card accommodation-request-card" key={record.accommodation_id}>
                <div className="accommodation-request-card__heading">
                  <h3>{record.person_name}</h3>
                  <span
                    className={`accommodation-request-status accommodation-request-status--${requestStatus.toLowerCase()}`}
                  >
                    {requestStatus}
                  </span>
                </div>
                <dl className="hospitality-card__details">
                  <div>
                    <dt>Check-in</dt>
                    <dd>{formatEventDate(record.check_in_date)}</dd>
                  </div>
                  <div>
                    <dt>Check-out</dt>
                    <dd>{formatEventDate(record.check_out_date)}</dd>
                  </div>
                  {requestStatus === "Approved" && (
                    <>
                      <div>
                        <dt>Building</dt>
                        <dd>{record.building_name || "Not assigned"}</dd>
                      </div>
                      <div>
                        <dt>Room</dt>
                        <dd>{record.room_number || "Not assigned"}</dd>
                      </div>
                    </>
                  )}
                </dl>

                {requestStatus === "Pending" && (
                  <div className="accommodation-request-card__actions">
                    {!availableRooms.length && state.activeRoomCount === 0 && (
                      <p className="accommodation-room-help" role="status">
                        No active rooms were found. Check that the rooms are marked active
                        in Supabase.
                      </p>
                    )}
                    <label className="nitt-admin__field">
                      <span>Available room</span>
                      <select
                        value={selectedRoomId}
                        disabled={!availableRooms.length || busyRequestId !== null}
                        onChange={(changeEvent) =>
                          setSelectedRooms((current) => ({
                            ...current,
                            [record.accommodation_id]: changeEvent.target.value,
                          }))
                        }
                      >
                        {!availableRooms.length && (
                          <option value="">
                            {state.activeRoomCount === 0
                              ? "No active rooms visible to the API"
                              : "No rooms available for these dates"}
                          </option>
                        )}
                        {availableRooms.map((room) => (
                          <option key={room.room_id} value={room.room_id}>
                            {room.building_name} / {room.room_number} —{" "}
                            {room.available_beds} of {room.capacity} beds available
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="accommodation-request-card__buttons">
                      <button
                        className="nitt-admin__button nitt-admin__button--primary"
                        type="button"
                        disabled={!selectedRoomId || busyRequestId !== null}
                        onClick={() => decideRequest(record, "approve")}
                      >
                        {busyRequestId === record.accommodation_id
                          ? "Saving…"
                          : "Approve"}
                      </button>
                      <button
                        className="nitt-admin__button nitt-admin__button--quiet"
                        type="button"
                        disabled={busyRequestId !== null}
                        onClick={() => decideRequest(record, "reject")}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="hospitality-message">
          No accommodation requests have been submitted for this event.
        </p>
      )}
    </section>
  );
}
