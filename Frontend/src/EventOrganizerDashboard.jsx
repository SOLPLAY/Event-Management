import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import logo from "./assets/nitt-logo1.jfif";
import EventCard from "./EventCard";
import EventWorkspace from "./EventWorkspace";
import { EVENT_WORKSPACE_SECTIONS } from "./eventWorkspaceSections";
import {
  clearLoginSession,
  eventPayload,
  eventStatuses,
  eventTypes,
  filterEvents,
  requestEventApi,
} from "./eventApi";

const emptyForm = {
  name: "",
  type: "",
  description: "",
  start_date: "",
  end_date: "",
};

export default function EventOrganizerDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = ["create", "events", "update", "workspace"].includes(requestedTab)
    ? requestedTab
    : "events";
  const requestedWorkspaceSection = searchParams.get("section");
  const activeWorkspaceSection = EVENT_WORKSPACE_SECTIONS.some(
    (section) => section.id === requestedWorkspaceSection
  )
    ? requestedWorkspaceSection
    : "overview";
  const [events, setEvents] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingEventId, setEditingEventId] = useState(null);
  const [editingEventStatus, setEditingEventStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyEventId, setBusyEventId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selectedEvent = events.find(
    (event) => String(event.event_id) === searchParams.get("event_id")
  );

  const loadEvents = useCallback(async () => {
    try {
      const result = await requestEventApi("/organizer/events");
      if (!Array.isArray(result.data)) {
        throw new Error("The server response did not contain an event list.");
      }
      setEvents(result.data);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function fetchInitialEvents() {
      try {
        const result = await requestEventApi("/organizer/events");
        if (!Array.isArray(result.data)) {
          throw new Error("The server response did not contain an event list.");
        }
        if (active) {
          setEvents(result.data);
          setError("");

          const initialParams = new URLSearchParams(window.location.search);
          if (initialParams.get("tab") === "update") {
            const requestedEventId = initialParams.get("event_id");
            const event = result.data.find(
              (candidate) => String(candidate.event_id) === requestedEventId
            );
            if (event) {
              setEditingEventId(event.event_id);
              setEditingEventStatus(event.event_status);
              setForm({
                name: event.name ?? "",
                type: event.type ?? "",
                description: event.description ?? "",
                start_date: event.start_date ?? "",
                end_date: event.end_date ?? "",
              });
            } else {
              setSearchParams({ tab: "events" }, { replace: true });
            }
          }
        }
      } catch (requestError) {
        if (active) setError(requestError.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchInitialEvents();
    return () => {
      active = false;
    };
  }, [setSearchParams]);

  const filteredEvents = useMemo(
    () => filterEvents(events, query, selectedStatus),
    [events, query, selectedStatus]
  );

  function updateField(field, value) {
    setForm((currentForm) => ({ ...currentForm, [field]: value }));
  }

  function startNewEvent() {
    setEditingEventId(null);
    setEditingEventStatus("");
    setForm({ ...emptyForm });
    setError("");
    setNotice("");
  }

  function editEvent(event) {
    setEditingEventId(event.event_id);
    setEditingEventStatus(event.event_status);
    setForm({
      name: event.name ?? "",
      type: event.type ?? "",
      description: event.description ?? "",
      start_date: event.start_date ?? "",
      end_date: event.end_date ?? "",
    });
    setSearchParams({ tab: "update", event_id: String(event.event_id) });
    setError("");
    setNotice("");
  }

  function selectTab(tab) {
    if (tab === "create") {
      startNewEvent();
      setSearchParams({ tab: "create" });
      return;
    }
    if (tab === "update") {
      const eventId = editingEventId ?? searchParams.get("event_id");
      if (eventId) {
        setSearchParams({ tab, event_id: String(eventId) });
        return;
      }
    }
    setSearchParams({ tab });
  }

  function viewEvent(event) {
    setSearchParams({
      tab: "workspace",
      event_id: String(event.event_id),
      section: "overview",
    });
    setError("");
    setNotice("");
  }

  function selectWorkspaceSection(section) {
    if (!selectedEvent) return;
    setSearchParams({
      tab: "workspace",
      event_id: String(selectedEvent.event_id),
      section,
    });
  }

  async function saveEvent(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await requestEventApi(
        editingEventId
          ? `/organizer/events/${editingEventId}`
          : "/organizer/events",
        {
          method: editingEventId ? "PUT" : "POST",
          body: eventPayload(form),
        }
      );
      setForm({ ...emptyForm });
      setEditingEventId(null);
      setEditingEventStatus("");
      setSearchParams({ tab: "events" });
      setNotice(
        !editingEventId
          ? "Your event was submitted for approval."
          : editingEventStatus === "Rejected"
            ? "Your updated event was resubmitted for approval."
            : "Your pending event was updated."
      );
      await loadEvents();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent(event) {
    if (!window.confirm(`Delete "${event.name}"?`)) return;
    setBusyEventId(event.event_id);
    setError("");
    setNotice("");
    try {
      await requestEventApi(`/organizer/events/${event.event_id}`, {
        method: "DELETE",
      });
      setNotice("Event deleted.");
      await loadEvents();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyEventId(null);
    }
  }

  async function publishEvent(eventId) {
    setBusyEventId(eventId);
    setError("");
    setNotice("");
    try {
      await requestEventApi(`/organizer/events/${eventId}/publish`, {
        method: "POST",
      });
      setNotice("Event published. Published events can no longer be edited or deleted.");
      await loadEvents();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyEventId(null);
    }
  }

  function logout() {
    clearLoginSession();
    navigate("/", { replace: true });
  }

  return (
    <main className="nitt-admin">
      <header className="nitt-admin__topbar">
        <div className="nitt-admin__brand">
          <img className="nitt-admin__brand-logo" src={logo} alt="" />
          <div>
            <div className="nitt-admin__brand-title">NIT TRICHY</div>
            <div className="nitt-admin__brand-sub">EVENT MANAGEMENT PORTAL</div>
          </div>
        </div>
        <div className="nitt-admin__session-actions">
          <div className="nitt-admin__profile">
            Signed in as {window.sessionStorage.getItem("loginUsername") || "Event Organizer"}
          </div>
          <button
            className="nitt-admin__button nitt-admin__button--quiet"
            type="button"
            onClick={logout}
          >
            Logout
          </button>
        </div>
      </header>

      <section
        className="nitt-admin__content event-organizer-content"
        aria-labelledby="organizer-heading"
      >
        <div className="nitt-admin__eyebrow">Event organizer</div>
        <div className="nitt-admin__heading">
          <div>
            <h1 id="organizer-heading">Manage events</h1>
            <p>Create events, track approvals, and publish approved events.</p>
          </div>
        </div>

        <div className="event-organizer-layout">
          <aside className="event-organizer-sidebar" aria-label="Event organizer navigation">
            <nav className="event-organizer-sidebar__nav">
              <button
                className={`event-organizer-sidebar__link${activeTab === "events" ? " event-organizer-sidebar__link--active" : ""}`}
                type="button"
                aria-current={activeTab === "events" ? "page" : undefined}
                onClick={() => {
                  selectTab("events");
                  setError("");
                }}
              >
                My events
              </button>
              <button
                className={`event-organizer-sidebar__link${activeTab === "create" ? " event-organizer-sidebar__link--active" : ""}`}
                type="button"
                aria-current={activeTab === "create" ? "page" : undefined}
                onClick={() => selectTab("create")}
              >
                Create event
              </button>
              {(editingEventId || activeTab === "update") && (
                <button
                  className={`event-organizer-sidebar__link${activeTab === "update" ? " event-organizer-sidebar__link--active" : ""}`}
                  type="button"
                  aria-current={activeTab === "update" ? "page" : undefined}
                  onClick={() => selectTab("update")}
                >
                  Update event
                </button>
              )}
            </nav>
            {activeTab === "workspace" && (
              <div className="event-organizer-sidebar__workspace">
                <div className="event-organizer-sidebar__title">
                  {selectedEvent?.name || "Selected event"}
                </div>
                <nav
                  className="event-organizer-sidebar__nav"
                  aria-label="Selected event pages"
                >
                  {EVENT_WORKSPACE_SECTIONS.map((section) => (
                    <button
                      key={section.id}
                      className={`event-organizer-sidebar__link event-organizer-sidebar__link--nested${activeTab === "workspace" && activeWorkspaceSection === section.id ? " event-organizer-sidebar__link--active" : ""}`}
                      type="button"
                      aria-current={
                        activeTab === "workspace" && activeWorkspaceSection === section.id
                          ? "page"
                          : undefined
                      }
                      disabled={!selectedEvent}
                      onClick={() => selectWorkspaceSection(section.id)}
                    >
                      {section.label}
                    </button>
                  ))}
                </nav>
              </div>
            )}
          </aside>

          <div className="event-organizer-main">
            {error && (
              <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
                {error}
              </p>
            )}
            {notice && <p className="nitt-admin__notice event-notice" role="status">{notice}</p>}

        {activeTab === "workspace" ? (
          selectedEvent ? (
            <EventWorkspace event={selectedEvent} section={activeWorkspaceSection} />
          ) : (
            <p className="event-list-message">
              {loading ? "Loading event details…" : "This event is not available."}
            </p>
          )
        ) : activeTab === "update" && !editingEventId ? (
          <p className="event-list-message">Loading event details…</p>
        ) : activeTab === "create" || activeTab === "update" ? (
          <section className="event-form-panel" role="tabpanel">
            <h2>{editingEventId ? "Update event details" : "Submit a new event"}</h2>
            <p className="nitt-admin__dialog-intro">
              {editingEventId
                ? editingEventStatus === "Rejected"
                  ? "Saving changes will resubmit this rejected event for approval."
                  : editingEventStatus === "Pending"
                      ? "Saving changes updates this event while it remains pending."
                      : "Saving changes updates this event."
                : "Submitted events are sent to the Super Admin for approval."}
            </p>
            <form onSubmit={saveEvent}>
              <div className="event-form-grid">
                <label className="nitt-admin__field">
                  <span>Event name</span>
                  <input
                    autoFocus
                    maxLength={300}
                    value={form.name}
                    onChange={(event) => updateField("name", event.target.value)}
                    required
                    disabled={saving}
                  />
                </label>
                <label className="nitt-admin__field">
                  <span>Event type</span>
                  <select
                    value={form.type}
                    onChange={(event) => updateField("type", event.target.value)}
                    required
                    disabled={saving}
                  >
                    <option value="" disabled>
                      Select an event type
                    </option>
                    {form.type &&
                      !eventTypes.includes(form.type) &&
                      <option value={form.type}>{form.type} (existing)</option>}
                    {eventTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="nitt-admin__field event-form-grid__description">
                  <span>Description</span>
                  <textarea
                    maxLength={5000}
                    rows={4}
                    value={form.description}
                    onChange={(event) => updateField("description", event.target.value)}
                    placeholder="Describe the event, its goals, or what participants can expect."
                    disabled={saving}
                  />
                </label>
                <label className="nitt-admin__field">
                  <span>Start date</span>
                  <input
                    type="date"
                    value={form.start_date}
                    max={form.end_date || undefined}
                    onChange={(event) => updateField("start_date", event.target.value)}
                    required
                    disabled={saving}
                  />
                </label>
                <label className="nitt-admin__field">
                  <span>End date</span>
                  <input
                    type="date"
                    value={form.end_date}
                    min={form.start_date || undefined}
                    onChange={(event) => updateField("end_date", event.target.value)}
                    required
                    disabled={saving}
                  />
                </label>
              </div>
              <div className="nitt-admin__dialog-actions">
                {editingEventId && (
                  <button
                    className="nitt-admin__button nitt-admin__button--quiet"
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      startNewEvent();
                      selectTab("events");
                    }}
                  >
                    Cancel
                  </button>
                )}
                <button
                  className="nitt-admin__button nitt-admin__button--primary"
                  type="submit"
                  disabled={saving}
                >
                  {saving
                    ? "Submitting…"
                    : editingEventId
                      ? "Submit for approval"
                      : "Submit event"}
                </button>
              </div>
            </form>
          </section>
        ) : (
          <>
            <div className="event-toolbar">
              <div className="nitt-admin__count">
                {loading ? "Loading events…" : `${filteredEvents.length} of ${events.length} events`}
              </div>
              <div className="event-toolbar__filters">
                <label>
                  <span className="sr-only">Search my events</span>
                  <input
                    className="nitt-admin__search"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search my events…"
                  />
                </label>
                <label>
                  <span className="sr-only">Filter my events by status</span>
                  <select
                    className="nitt-admin__search"
                    value={selectedStatus}
                    onChange={(event) => setSelectedStatus(event.target.value)}
                  >
                    {eventStatuses.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            {loading ? (
              <p className="event-list-message">Loading events…</p>
            ) : filteredEvents.length ? (
              <div className="event-card-grid">
                {filteredEvents.map((event) => (
                  <EventCard
                    key={event.event_id}
                    event={event}
                    mode="organizer"
                    busy={busyEventId === event.event_id}
                    onView={viewEvent}
                    onUpdate={editEvent}
                    onDelete={deleteEvent}
                    onPublish={publishEvent}
                  />
                ))}
              </div>
            ) : (
              <p className="event-list-message">
                {events.length
                  ? "No events match your search or status filter."
                  : "You have not submitted any events yet."}
              </p>
            )}
          </>
        )}
          </div>
        </div>
      </section>
    </main>
  );
}
