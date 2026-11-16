import { useEffect, useState } from "react";
import { formatDateTime } from "./user/userApi";
import { requestEventApi } from "./eventApi";

export default function EventSessionAttendance({ event, session, onBack }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyRegistrationId, setBusyRegistrationId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    requestEventApi(
      `/organizer/events/${event.event_id}/sessions/${session.session_id}/attendance`
    )
      .then((result) => {
        if (!Array.isArray(result.data)) {
          throw new Error("The server response did not contain attendance records.");
        }
        if (active) {
          setRecords(result.data);
          setError("");
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [event.event_id, session.session_id]);

  async function markAttendance(registrationId, attendanceStatus) {
    setBusyRegistrationId(registrationId);
    setError("");
    try {
      const result = await requestEventApi(
        `/organizer/events/${event.event_id}/sessions/${session.session_id}/attendance/${registrationId}`,
        {
          method: "PUT",
          body: JSON.stringify({ attendance_status: attendanceStatus }),
        }
      );
      setRecords((currentRecords) =>
        currentRecords.map((record) =>
          String(record.registration_id) === String(registrationId)
            ? { ...record, ...result.data }
            : record
        )
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyRegistrationId(null);
    }
  }

  return (
    <section className="event-workspace-panel event-sessions-panel" aria-labelledby="session-attendance-heading">
      <div className="event-workspace-panel__eyebrow">{event.name}</div>
      <h2 id="session-attendance-heading">Mark attendance</h2>
      <h3>{session.session_title}</h3>
      <p>
        {formatDateTime(session.start_time)} – {formatDateTime(session.end_time)}
        {session.venue ? ` · ${session.venue}` : ""}
      </p>
      <div className="event-session-card__actions">
        <button
          className="nitt-admin__button nitt-admin__button--quiet"
          type="button"
          disabled={busyRegistrationId !== null}
          onClick={onBack}
        >
          Back to sessions
        </button>
      </div>
      {error && (
        <p className="hospitality-message hospitality-message--error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="hospitality-message" role="status">Loading registered students…</p>
      ) : records.length ? (
        <div className="registration-table-wrap">
          <table className="registration-table">
            <thead>
              <tr>
                <th scope="col">Student</th>
                <th scope="col">Registration status</th>
                <th scope="col">Attendance</th>
                <th scope="col">Mark</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.registration_id}>
                  <td>{record.person_name}</td>
                  <td>{record.status}</td>
                  <td>{record.attendance_status || "Not marked"}</td>
                  <td>
                    <div className="session-attendance-actions">
                      {["Present", "Absent"].map((status) => (
                        <button
                          key={status}
                          className={`nitt-admin__button ${
                            record.attendance_status === status
                              ? "nitt-admin__button--primary"
                              : "nitt-admin__button--quiet"
                          }`}
                          type="button"
                          disabled={busyRegistrationId !== null}
                          aria-pressed={record.attendance_status === status}
                          onClick={() =>
                            markAttendance(record.registration_id, status)
                          }
                        >
                          {busyRegistrationId === record.registration_id
                            ? "Saving…"
                            : status}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="hospitality-message">
          No students have registered for this event.
        </p>
      )}
    </section>
  );
}
