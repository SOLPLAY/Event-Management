import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { formatDateTime } from "./user/userApi";
import { requestEventApi } from "./eventApi";
import EventSessionAttendance from "./EventSessionAttendance";

const emptyForm = {
  session_title: "",
  speaker_name: "",
  start_time: "",
  end_time: "",
  venue: "",
};

function toLocalDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function sessionForm(session) {
  return {
    session_title: session.session_title ?? "",
    speaker_name: session.speaker_name ?? "",
    start_time: toLocalDateTimeInput(session.start_time),
    end_time: toLocalDateTimeInput(session.end_time),
    venue: session.venue ?? "",
  };
}

export default function EventSessions({ event }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeSubtab, setActiveSubtab] = useState("details");
  const [sessionsState, setSessionsState] = useState({
    eventId: null,
    records: [],
    error: "",
  });
  const [form, setForm] = useState(emptyForm);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busySessionId, setBusySessionId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loading = sessionsState.eventId !== event.event_id;
  const attendanceSessionId = searchParams.get("attendance_session_id");
  const attendanceSession = sessionsState.records.find(
    (session) => String(session.session_id) === attendanceSessionId
  );

  const loadSessions = useCallback(async () => {
    try {
      const result = await requestEventApi(`/organizer/events/${event.event_id}/sessions`);
      if (!Array.isArray(result.data)) {
        throw new Error("The server response did not contain session records.");
      }
      setSessionsState({ eventId: event.event_id, records: result.data, error: "" });
    } catch (requestError) {
      setSessionsState({
        eventId: event.event_id,
        records: [],
        error: requestError.message,
      });
    }
  }, [event.event_id]);

  useEffect(() => {
    let active = true;

    requestEventApi(`/organizer/events/${event.event_id}/sessions`)
      .then((result) => {
        if (!Array.isArray(result.data)) {
          throw new Error("The server response did not contain session records.");
        }
        if (active) {
          setSessionsState({ eventId: event.event_id, records: result.data, error: "" });
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
  }, [event.event_id]);

  function updateField(field, value) {
    setForm((currentForm) => ({ ...currentForm, [field]: value }));
  }

  function openAttendance(session) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("attendance_session_id", String(session.session_id));
    setSearchParams(nextParams);
  }

  function closeAttendance() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("attendance_session_id");
    setSearchParams(nextParams);
  }

  if (attendanceSessionId) {
    if (loading) {
      return (
        <section className="event-workspace-panel event-sessions-panel">
          <p className="hospitality-message" role="status">Loading session…</p>
        </section>
      );
    }
    if (!attendanceSession) {
      return (
        <section className="event-workspace-panel event-sessions-panel">
          <p className="hospitality-message">This session is not available.</p>
          <button
            className="nitt-admin__button nitt-admin__button--quiet"
            type="button"
            onClick={closeAttendance}
          >
            Back to sessions
          </button>
        </section>
      );
    }
    return (
      <EventSessionAttendance
        key={`${event.event_id}-${attendanceSession.session_id}`}
        event={event}
        session={attendanceSession}
        onBack={closeAttendance}
      />
    );
  }

  function startEditing(session) {
    setEditingSessionId(session.session_id);
    setForm(sessionForm(session));
    setError("");
    setNotice("");
  }

  function cancelEditing() {
    setEditingSessionId(null);
    setForm({ ...emptyForm });
  }

  async function saveSession(submitEvent) {
    submitEvent.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    const body = JSON.stringify({
      session_title: form.session_title.trim(),
      speaker_name: form.speaker_name.trim() || null,
      start_time: form.start_time,
      end_time: form.end_time,
      venue: form.venue.trim() || null,
    });

    try {
      const path = `/organizer/events/${event.event_id}/sessions`;
      await requestEventApi(
        editingSessionId ? `${path}/${editingSessionId}` : path,
        {
          method: editingSessionId ? "PUT" : "POST",
          body,
        }
      );
      setNotice(editingSessionId ? "Session updated." : "Session added.");
      cancelEditing();
      await loadSessions();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteSession(session) {
    if (!window.confirm(`Delete "${session.session_title}"?`)) return;
    setBusySessionId(session.session_id);
    setError("");
    setNotice("");
    try {
      await requestEventApi(
        `/organizer/events/${event.event_id}/sessions/${session.session_id}`,
        { method: "DELETE" }
      );
      if (editingSessionId === session.session_id) cancelEditing();
      setNotice("Session deleted.");
      await loadSessions();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusySessionId(null);
    }
  }

  return (
    <section className="event-workspace-panel event-sessions-panel" aria-labelledby="event-workspace-heading">
      <div className="event-workspace-panel__eyebrow">{event.name}</div>
      <h2 id="event-workspace-heading">Sessions</h2>
      <p>Create and manage the schedule for this event.</p>

      <div className="event-tabs" role="tablist" aria-label="Session sections">
        {[
          { id: "details", label: "Details" },
          { id: "manage", label: "Manage sessions" },
        ].map((tab) => (
          <button
            key={tab.id}
            id={`sessions-${tab.id}-tab`}
            className={`event-tabs__tab${activeSubtab === tab.id ? " event-tabs__tab--active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeSubtab === tab.id}
            aria-controls="sessions-tabpanel"
            onClick={() => setActiveSubtab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
          {error}
        </p>
      )}
      {sessionsState.error && (
        <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
          {sessionsState.error}
        </p>
      )}
      {notice && <p className="nitt-admin__notice event-notice" role="status">{notice}</p>}

      <div
        id="sessions-tabpanel"
        role="tabpanel"
        aria-labelledby={`sessions-${activeSubtab}-tab`}
      >
      {activeSubtab === "manage" && (
      <form className="event-sessions-form" onSubmit={saveSession}>
        <h3>{editingSessionId ? "Edit session" : "Add a session"}</h3>
        <div className="event-form-grid">
          <label className="nitt-admin__field">
            <span>Session title</span>
            <input
              maxLength={250}
              value={form.session_title}
              onChange={(submitEvent) => updateField("session_title", submitEvent.target.value)}
              required
              disabled={saving}
            />
          </label>
          <label className="nitt-admin__field">
            <span>Speaker</span>
            <input
              value={form.speaker_name}
              onChange={(submitEvent) => updateField("speaker_name", submitEvent.target.value)}
              disabled={saving}
            />
          </label>
          <label className="nitt-admin__field">
            <span>Start time</span>
            <input
              type="datetime-local"
              value={form.start_time}
              max={form.end_time || undefined}
              onChange={(submitEvent) => updateField("start_time", submitEvent.target.value)}
              required
              disabled={saving}
            />
          </label>
          <label className="nitt-admin__field">
            <span>End time</span>
            <input
              type="datetime-local"
              value={form.end_time}
              min={form.start_time || undefined}
              onChange={(submitEvent) => updateField("end_time", submitEvent.target.value)}
              required
              disabled={saving}
            />
          </label>
          <label className="nitt-admin__field">
            <span>Venue</span>
            <input
              value={form.venue}
              onChange={(submitEvent) => updateField("venue", submitEvent.target.value)}
              disabled={saving}
            />
          </label>
        </div>
        <div className="event-sessions-form__actions">
          {editingSessionId && (
            <button
              className="nitt-admin__button nitt-admin__button--quiet"
              type="button"
              disabled={saving}
              onClick={cancelEditing}
            >
              Cancel
            </button>
          )}
          <button
            className="nitt-admin__button nitt-admin__button--primary"
            type="submit"
            disabled={saving}
          >
            {saving ? "Saving…" : editingSessionId ? "Save changes" : "Add session"}
          </button>
        </div>
      </form>
      )}

      <section className="event-session-section" aria-labelledby="event-session-list-heading">
        <h3 id="event-session-list-heading">
          {activeSubtab === "details" ? "Event schedule" : "Manage event schedule"}
        </h3>
        {loading ? (
          <p className="hospitality-message" role="status">Loading sessions…</p>
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
                <div className="event-session-card__actions">
                  <button
                    className="nitt-admin__button nitt-admin__button--primary"
                    type="button"
                    disabled={saving || busySessionId !== null}
                    onClick={() => openAttendance(session)}
                  >
                    Mark attendance
                  </button>
                  {activeSubtab === "manage" && (
                    <>
                      <button
                        className="nitt-admin__button nitt-admin__button--quiet"
                        type="button"
                        disabled={saving || busySessionId !== null}
                        onClick={() => {
                          startEditing(session);
                          setActiveSubtab("manage");
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="nitt-admin__button nitt-admin__button--quiet"
                        type="button"
                        disabled={saving || busySessionId !== null}
                        onClick={() => deleteSession(session)}
                      >
                        {busySessionId === session.session_id ? "Deleting…" : "Delete"}
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="hospitality-message">
            No sessions have been added to this event yet.
            {activeSubtab === "details" ? " Use Manage sessions to add one." : ""}
          </p>
        )}
      </section>
      </div>
    </section>
  );
}
