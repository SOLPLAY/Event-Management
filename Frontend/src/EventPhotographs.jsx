import { useCallback, useEffect, useState } from "react";
import { formatEventDate, requestEventApi } from "./eventApi";

function photographEndpoint(eventId, photographId = "") {
  const suffix = photographId ? `/${photographId}` : "";
  return `/organizer/events/${eventId}/photographs${suffix}`;
}

async function fetchEventPhotographs(eventId) {
  const result = await requestEventApi(photographEndpoint(eventId));
  if (!Array.isArray(result.data)) {
    throw new Error("The server response did not contain photographs.");
  }
  return result.data;
}

export default function EventPhotographs({ event }) {
  const eventId = event.event_id;
  const [photographs, setPhotographs] = useState([]);
  const [caption, setCaption] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingCaption, setEditingCaption] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadPhotographs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPhotographs(await fetchEventPhotographs(eventId));
    } catch (requestError) {
      setPhotographs([]);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    let active = true;
    fetchEventPhotographs(eventId)
      .then((items) => {
        if (active) {
          setPhotographs(items);
          setError("");
        }
      })
      .catch((requestError) => {
        if (active) {
          setPhotographs([]);
          setError(requestError.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [eventId]);

  async function addPhotograph(submitEvent) {
    submitEvent.preventDefault();
    if (!selectedFile || saving) return;
    const form = submitEvent.currentTarget;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const body = new FormData();
      body.append("photo", selectedFile);
      body.append("caption", caption);
      await requestEventApi(photographEndpoint(eventId), {
        method: "POST",
        body,
      });
      setCaption("");
      setSelectedFile(null);
      form.reset();
      setNotice("Photograph added.");
      await loadPhotographs();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveCaption(photographId) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await requestEventApi(photographEndpoint(eventId, photographId), {
        method: "PATCH",
        body: JSON.stringify({ caption: editingCaption }),
      });
      setEditingId(null);
      setNotice("Caption updated.");
      await loadPhotographs();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function replacePhotograph(photographId, file) {
    if (!file || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const body = new FormData();
      body.append("photo", file);
      const result = await requestEventApi(
        `${photographEndpoint(eventId, photographId)}/image`,
        { method: "PUT", body }
      );
      setNotice(result.warning || "Photograph replaced.");
      await loadPhotographs();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function deletePhotograph(photographId) {
    if (saving || !window.confirm("Delete this event photograph?")) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await requestEventApi(photographEndpoint(eventId, photographId), {
        method: "DELETE",
      });
      setNotice(result.warning || "Photograph deleted.");
      await loadPhotographs();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
      <div className="event-workspace-panel__eyebrow">{event.name}</div>
      <h2 id="event-workspace-heading">Event photographs</h2>
      <p>Add, update, and remove photographs. Published event photographs are visible to users.</p>

      {error && <p className="hospitality-message hospitality-message--error" role="alert">{error}</p>}
      {notice && <p className="hospitality-message" role="status">{notice}</p>}

      <form className="event-photographs-upload" onSubmit={addPhotograph}>
        <label className="nitt-admin__field">
          <span>Photograph</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(changeEvent) => setSelectedFile(changeEvent.target.files?.[0] ?? null)}
            required
            disabled={saving}
          />
        </label>
        <label className="nitt-admin__field">
          <span>Caption <small className="nitt-admin__optional">(optional)</small></span>
          <input
            type="text"
            value={caption}
            maxLength={500}
            onChange={(changeEvent) => setCaption(changeEvent.target.value)}
            disabled={saving}
          />
        </label>
        <button className="nitt-admin__button nitt-admin__button--primary" type="submit" disabled={saving || !selectedFile}>
          {saving ? "Saving…" : "Add photograph"}
        </button>
        <p className="event-photographs-upload__hint">JPEG, PNG, or WebP - up to 20 MB</p>
      </form>

      {loading ? (
        <p className="hospitality-message" role="status">Loading photographs…</p>
      ) : photographs.length ? (
        <div className="event-photographs-grid">
          {photographs.map((photograph, index) => (
            <article className="event-photograph-card" key={photograph.photograph_id}>
              <a href={photograph.photograph_url} target="_blank" rel="noopener noreferrer">
                <img
                  src={photograph.photograph_url}
                  alt={photograph.caption || `Event photograph ${index + 1}`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              </a>
              <div className="event-photograph-card__body">
                {editingId === photograph.photograph_id ? (
                  <form
                    onSubmit={(submitEvent) => {
                      submitEvent.preventDefault();
                      saveCaption(photograph.photograph_id);
                    }}
                  >
                    <label className="nitt-admin__field">
                      <span>Caption</span>
                      <input
                        type="text"
                        value={editingCaption}
                        maxLength={500}
                        onChange={(changeEvent) => setEditingCaption(changeEvent.target.value)}
                        disabled={saving}
                      />
                    </label>
                    <div className="event-photograph-card__actions">
                      <button className="nitt-admin__button nitt-admin__button--primary" type="submit" disabled={saving}>Save caption</button>
                      <button className="nitt-admin__button nitt-admin__button--quiet" type="button" onClick={() => setEditingId(null)} disabled={saving}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <p className="event-photograph-card__caption">
                    {photograph.caption || "No caption"}
                    {photograph.created_date && <small>Added {formatEventDate(photograph.created_date)}</small>}
                  </p>
                )}
                <div className="event-photograph-card__actions">
                  <button
                    className="nitt-admin__button nitt-admin__button--quiet"
                    type="button"
                    disabled={saving || editingId === photograph.photograph_id}
                    onClick={() => {
                      setEditingId(photograph.photograph_id);
                      setEditingCaption(photograph.caption || "");
                    }}
                  >
                    Edit caption
                  </button>
                  <label className="nitt-admin__button nitt-admin__button--quiet event-photograph-card__replace">
                    Replace image
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={saving}
                      onChange={(changeEvent) => {
                        const file = changeEvent.target.files?.[0];
                        replacePhotograph(photograph.photograph_id, file);
                        changeEvent.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    className="nitt-admin__button nitt-admin__button--quiet"
                    type="button"
                    disabled={saving}
                    onClick={() => deletePhotograph(photograph.photograph_id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="hospitality-message">No photographs have been added to this event yet.</p>
      )}
    </section>
  );
}
