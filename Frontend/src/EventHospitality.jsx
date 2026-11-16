import { useEffect, useState } from "react";
import { formatEventDate, requestEventApi } from "./eventApi";

function todayInputValue() {
  const today = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

function emptyForm() {
  return {
    meal_type: "",
    service_date: todayInputValue(),
    head_count: "",
    vendor_name: "",
  };
}

function formForRecord(record) {
  return {
    meal_type: record.meal_type ?? "",
    service_date: record.service_date ?? "",
    head_count: record.head_count ?? "",
    vendor_name: record.vendor_name ?? "",
  };
}

function sortByServiceDate(records) {
  return [...records].sort((first, second) =>
    String(first.service_date).localeCompare(String(second.service_date))
  );
}

export default function EventHospitality({ event }) {
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyRecordId, setBusyRecordId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const path = `/organizer/events/${event.event_id}/hospitality`;

  useEffect(() => {
    let active = true;
    requestEventApi(path)
      .then((result) => {
        if (!Array.isArray(result.data)) {
          throw new Error("The server response did not contain hospitality records.");
        }
        if (active) {
          setRecords(sortByServiceDate(result.data));
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
  }, [path]);

  function updateField(field, value) {
    setForm((currentForm) => ({ ...currentForm, [field]: value }));
  }

  function startEditing(record) {
    setEditingId(record.hospitality_id);
    setForm(formForRecord(record));
    setError("");
    setNotice("");
  }

  function cancelEditing() {
    setEditingId(null);
    setForm(emptyForm());
  }

  async function saveRecord(submitEvent) {
    submitEvent.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    const body = JSON.stringify({
      meal_type: form.meal_type.trim(),
      service_date: form.service_date,
      head_count: Number(form.head_count),
      vendor_name: form.vendor_name.trim(),
    });

    try {
      const result = await requestEventApi(
        editingId ? `${path}/${editingId}` : path,
        {
          method: editingId ? "PUT" : "POST",
          body,
        }
      );
      if (editingId) {
        setRecords((currentRecords) =>
          sortByServiceDate(
            currentRecords.map((record) =>
              String(record.hospitality_id) === String(editingId)
                ? result.data
                : record
            )
          )
        );
        setNotice("Hospitality details updated.");
      } else {
        setRecords((currentRecords) =>
          sortByServiceDate([...currentRecords, result.data])
        );
        setNotice("Hospitality details added.");
      }
      cancelEditing();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord(record) {
    if (
      !window.confirm(
        `Delete ${record.meal_type} hospitality details for ${formatEventDate(record.service_date)}?`
      )
    ) {
      return;
    }
    setBusyRecordId(record.hospitality_id);
    setError("");
    setNotice("");
    try {
      await requestEventApi(`${path}/${record.hospitality_id}`, {
        method: "DELETE",
      });
      setRecords((currentRecords) =>
        currentRecords.filter(
          (item) =>
            String(item.hospitality_id) !== String(record.hospitality_id)
        )
      );
      if (String(editingId) === String(record.hospitality_id)) cancelEditing();
      setNotice("Hospitality details deleted.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyRecordId(null);
    }
  }

  return (
    <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
      <div className="event-workspace-panel__eyebrow">{event.name}</div>
      <h2 id="event-workspace-heading">Hospitality</h2>
      <p>Plan meals, vendors, service dates, and expected head counts.</p>

      {error && (
        <p className="hospitality-message hospitality-message--error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="hospitality-message" role="status">{notice}</p>}

      <form className="event-sessions-form" onSubmit={saveRecord}>
        <h3>{editingId ? "Edit hospitality details" : "Add hospitality details"}</h3>
        <div className="event-form-grid">
          <label className="nitt-admin__field">
            <span>Meal type</span>
            <input
              maxLength={100}
              value={form.meal_type}
              onChange={(inputEvent) => updateField("meal_type", inputEvent.target.value)}
              required
              disabled={saving}
            />
          </label>
          <label className="nitt-admin__field">
            <span>Service date</span>
            <input
              type="date"
              value={form.service_date}
              onChange={(inputEvent) => updateField("service_date", inputEvent.target.value)}
              required
              disabled={saving}
            />
          </label>
          <label className="nitt-admin__field">
            <span>Head count</span>
            <input
              type="number"
              min="0"
              step="1"
              value={form.head_count}
              onChange={(inputEvent) => updateField("head_count", inputEvent.target.value)}
              required
              disabled={saving}
            />
          </label>
          <label className="nitt-admin__field">
            <span>Vendor</span>
            <input
              maxLength={250}
              value={form.vendor_name}
              onChange={(inputEvent) => updateField("vendor_name", inputEvent.target.value)}
              disabled={saving}
            />
          </label>
        </div>
        <div className="event-sessions-form__actions">
          {editingId && (
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
            {saving ? "Saving…" : editingId ? "Save changes" : "Add hospitality"}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="hospitality-message" role="status">Loading hospitality details…</p>
      ) : records.length ? (
        <div className="hospitality-grid">
          {records.map((record) => (
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
              <div className="event-session-card__actions">
                <button
                  className="nitt-admin__button nitt-admin__button--quiet"
                  type="button"
                  disabled={saving || busyRecordId !== null}
                  onClick={() => startEditing(record)}
                >
                  Edit
                </button>
                <button
                  className="nitt-admin__button nitt-admin__button--danger"
                  type="button"
                  disabled={saving || busyRecordId !== null}
                  onClick={() => deleteRecord(record)}
                >
                  {busyRecordId === record.hospitality_id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="hospitality-message">
          No hospitality details have been added for this event yet.
        </p>
      )}
    </section>
  );
}
