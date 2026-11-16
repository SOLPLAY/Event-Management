import { useEffect, useRef, useState } from "react";
import { formatEventDate, requestEventApi } from "./eventApi";

const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MEDIA_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime";

function todayInputValue() {
  const today = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

function emptyAdvertisementForm() {
  return { platform: "", target_audience: "", publish_date: todayInputValue() };
}

function emptySponsorForm() {
  return {
    sponsor_name: "",
    sponsorship_level: "Sponsor",
    contact_person: "",
    contact_email: "",
    contact_phone: "",
    sponsorship_amount: "",
    notes: "",
  };
}

function sponsorFormForRecord(sponsor) {
  return {
    sponsor_name: sponsor.sponsor_name ?? "",
    sponsorship_level: sponsor.sponsorship_level ?? "Sponsor",
    contact_person: sponsor.contact_person ?? "",
    contact_email: sponsor.contact_email ?? "",
    contact_phone: sponsor.contact_phone ?? "",
    sponsorship_amount: sponsor.sponsorship_amount ?? "",
    notes: sponsor.notes ?? "",
  };
}

function formatAmount(value) {
  if (value === null || value === undefined || value === "") return "Not provided";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function upsertRecord(records, record, key) {
  const exists = records.some((item) => String(item[key]) === String(record[key]));
  return exists
    ? records.map((item) =>
        String(item[key]) === String(record[key]) ? { ...item, ...record } : item
      )
    : [...records, record];
}

export default function EventAdvertisement({ event }) {
  const apiPath = `/organizer/events/${event.event_id}`;
  const mediaInputRef = useRef(null);
  const [advertisements, setAdvertisements] = useState([]);
  const [sponsors, setSponsors] = useState([]);
  const [advertisementForm, setAdvertisementForm] = useState(emptyAdvertisementForm);
  const [sponsorForm, setSponsorForm] = useState(emptySponsorForm);
  const [editingAdId, setEditingAdId] = useState(null);
  const [editingSponsorId, setEditingSponsorId] = useState(null);
  const [mediaFile, setMediaFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingAd, setSavingAd] = useState(false);
  const [savingSponsor, setSavingSponsor] = useState(false);
  const [busyRecord, setBusyRecord] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      requestEventApi(`${apiPath}/advertisements`),
      requestEventApi(`${apiPath}/sponsors`),
    ])
      .then(([advertisementResult, sponsorResult]) => {
        if (!Array.isArray(advertisementResult.data) || !Array.isArray(sponsorResult.data)) {
          throw new Error("The server response did not contain valid advertisement and sponsor records.");
        }
        if (active) {
          setAdvertisements(advertisementResult.data);
          setSponsors(sponsorResult.data);
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
  }, [apiPath]);

  function resetAdvertisementForm() {
    setEditingAdId(null);
    setAdvertisementForm(emptyAdvertisementForm());
    setMediaFile(null);
    if (mediaInputRef.current) mediaInputRef.current.value = "";
  }

  function resetSponsorForm() {
    setEditingSponsorId(null);
    setSponsorForm(emptySponsorForm());
  }

  function startEditingAd(advertisement) {
    setEditingAdId(advertisement.ad_id);
    setAdvertisementForm({
      platform: advertisement.platform ?? "",
      target_audience: advertisement.target_audience ?? "",
      publish_date: String(advertisement.publish_date ?? "").slice(0, 10),
    });
    setMediaFile(null);
    if (mediaInputRef.current) mediaInputRef.current.value = "";
    setError("");
    setNotice("");
  }

  async function saveAdvertisement(submitEvent) {
    submitEvent.preventDefault();
    setSavingAd(true);
    setError("");
    setNotice("");
    const body = JSON.stringify({
      platform: advertisementForm.platform.trim(),
      target_audience: advertisementForm.target_audience.trim(),
      publish_date: advertisementForm.publish_date,
    });

    try {
      const result = await requestEventApi(
        editingAdId
          ? `${apiPath}/advertisements/${editingAdId}`
          : `${apiPath}/advertisements`,
        { method: editingAdId ? "PUT" : "POST", body }
      );
      let uploadWarning = null;
      const previous = advertisements.find(
        (item) => String(item.ad_id) === String(editingAdId)
      );
      let savedAdvertisement = {
        ...previous,
        ...result.data,
        media_url: result.data.media_url ?? previous?.media_url ?? null,
      };

      if (mediaFile) {
        const formData = new FormData();
        formData.append("media", mediaFile);
        try {
          const uploaded = await requestEventApi(
            `${apiPath}/advertisements/${savedAdvertisement.ad_id}/media`,
            { method: "POST", body: formData }
          );
          savedAdvertisement = uploaded.data;
          uploadWarning = uploaded.warning;
        } catch (uploadError) {
          setAdvertisements((records) =>
            upsertRecord(records, savedAdvertisement, "ad_id")
          );
          resetAdvertisementForm();
          setError(`Advertisement saved, but the media upload failed: ${uploadError.message}`);
          return;
        }
      }

      setAdvertisements((records) =>
        upsertRecord(records, savedAdvertisement, "ad_id").sort((first, second) =>
          String(first.publish_date).localeCompare(String(second.publish_date))
        )
      );
      setNotice(
        uploadWarning ||
          (editingAdId ? "Advertisement updated." : "Advertisement added.")
      );
      resetAdvertisementForm();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingAd(false);
    }
  }

  function chooseMedia(inputEvent) {
    const selectedFile = inputEvent.target.files?.[0] ?? null;
    if (selectedFile && selectedFile.size > MAX_MEDIA_BYTES) {
      setMediaFile(null);
      inputEvent.target.value = "";
      setError("Image and video files must be 50 MB or smaller.");
      return;
    }
    setError("");
    setMediaFile(selectedFile);
  }

  async function deleteAdvertisement(advertisement) {
    if (!window.confirm(`Delete the ${advertisement.platform} advertisement and its poster?`)) {
      return;
    }
    setBusyRecord(`ad-${advertisement.ad_id}`);
    setError("");
    setNotice("");
    try {
      const result = await requestEventApi(`${apiPath}/advertisements/${advertisement.ad_id}`, {
        method: "DELETE",
      });
      setAdvertisements((records) =>
        records.filter((item) => String(item.ad_id) !== String(advertisement.ad_id))
      );
      if (String(editingAdId) === String(advertisement.ad_id)) resetAdvertisementForm();
      setNotice(result.warning || "Advertisement deleted.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyRecord("");
    }
  }

  async function deleteAdvertisementMedia(advertisement) {
    setBusyRecord(`media-${advertisement.ad_id}`);
    setError("");
    setNotice("");
    try {
      const result = await requestEventApi(
        `${apiPath}/advertisements/${advertisement.ad_id}/media`,
        { method: "DELETE" }
      );
      setAdvertisements((records) =>
        records.map((item) =>
          String(item.ad_id) === String(advertisement.ad_id)
            ? {
                ...item,
                media_path: null,
                media_content_type: null,
                media_file_name: null,
                media_url: null,
              }
            : item
        )
      );
      setNotice(result.warning || "Advertisement media deleted.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyRecord("");
    }
  }

  async function saveSponsor(submitEvent) {
    submitEvent.preventDefault();
    setSavingSponsor(true);
    setError("");
    setNotice("");
    const body = JSON.stringify({
      ...sponsorForm,
      sponsor_name: sponsorForm.sponsor_name.trim(),
      sponsorship_level: sponsorForm.sponsorship_level.trim(),
      contact_person: sponsorForm.contact_person.trim() || null,
      contact_email: sponsorForm.contact_email.trim() || null,
      contact_phone: sponsorForm.contact_phone.trim() || null,
      sponsorship_amount:
        sponsorForm.sponsorship_amount === ""
          ? null
          : Number(sponsorForm.sponsorship_amount),
      notes: sponsorForm.notes.trim() || null,
    });

    try {
      const result = await requestEventApi(
        editingSponsorId
          ? `${apiPath}/sponsors/${editingSponsorId}`
          : `${apiPath}/sponsors`,
        { method: editingSponsorId ? "PUT" : "POST", body }
      );
      setSponsors((records) =>
        upsertRecord(records, result.data, "sponsor_id").sort((first, second) =>
          first.sponsor_name.localeCompare(second.sponsor_name)
        )
      );
      setNotice(editingSponsorId ? "Sponsor details updated." : "Sponsor added.");
      resetSponsorForm();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingSponsor(false);
    }
  }

  async function deleteSponsor(sponsor) {
    if (!window.confirm(`Delete sponsor "${sponsor.sponsor_name}"?`)) return;
    setBusyRecord(`sponsor-${sponsor.sponsor_id}`);
    setError("");
    setNotice("");
    try {
      await requestEventApi(`${apiPath}/sponsors/${sponsor.sponsor_id}`, {
        method: "DELETE",
      });
      setSponsors((records) =>
        records.filter((item) => String(item.sponsor_id) !== String(sponsor.sponsor_id))
      );
      if (String(editingSponsorId) === String(sponsor.sponsor_id)) resetSponsorForm();
      setNotice("Sponsor deleted.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyRecord("");
    }
  }

  return (
    <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
      <div className="event-workspace-panel__eyebrow">{event.name}</div>
      <h2 id="event-workspace-heading">Advertisement &amp; Sponsors</h2>
      <p>Manage promotion schedules, poster media, and event sponsor information.</p>

      {error && (
        <p className="hospitality-message hospitality-message--error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="hospitality-message" role="status">{notice}</p>}

      <form className="event-sessions-form" onSubmit={saveAdvertisement}>
        <h3>{editingAdId ? "Edit advertisement" : "Add advertisement"}</h3>
        <div className="event-form-grid">
          <label className="nitt-admin__field">
            <span>Platform</span>
            <input
              maxLength={150}
              value={advertisementForm.platform}
              onChange={(inputEvent) =>
                setAdvertisementForm((form) => ({ ...form, platform: inputEvent.target.value }))
              }
              required
              disabled={savingAd}
            />
          </label>
          <label className="nitt-admin__field">
            <span>Publish date</span>
            <input
              type="date"
              value={advertisementForm.publish_date}
              onChange={(inputEvent) =>
                setAdvertisementForm((form) => ({ ...form, publish_date: inputEvent.target.value }))
              }
              required
              disabled={savingAd}
            />
          </label>
          <label className="nitt-admin__field">
            <span>Target audience</span>
            <input
              maxLength={500}
              value={advertisementForm.target_audience}
              onChange={(inputEvent) =>
                setAdvertisementForm((form) => ({
                  ...form,
                  target_audience: inputEvent.target.value,
                }))
              }
              disabled={savingAd}
            />
          </label>
          <label className="nitt-admin__field">
            <span>Poster image or video (optional, max 50 MB)</span>
            <input
              ref={mediaInputRef}
              type="file"
              accept={MEDIA_ACCEPT}
              onChange={chooseMedia}
              disabled={savingAd}
            />
          </label>
        </div>
        <div className="event-sessions-form__actions">
          {editingAdId && (
            <button
              className="nitt-admin__button nitt-admin__button--quiet"
              type="button"
              disabled={savingAd}
              onClick={resetAdvertisementForm}
            >
              Cancel
            </button>
          )}
          <button
            className="nitt-admin__button nitt-admin__button--primary"
            type="submit"
            disabled={savingAd}
          >
            {savingAd ? "Saving…" : editingAdId ? "Save advertisement" : "Add advertisement"}
          </button>
        </div>
      </form>

      <form className="event-sessions-form" onSubmit={saveSponsor}>
        <h3>{editingSponsorId ? "Edit sponsor" : "Add sponsor"}</h3>
        <div className="event-form-grid">
          <label className="nitt-admin__field">
            <span>Sponsor / organization name</span>
            <input
              maxLength={250}
              value={sponsorForm.sponsor_name}
              onChange={(inputEvent) =>
                setSponsorForm((form) => ({ ...form, sponsor_name: inputEvent.target.value }))
              }
              required
              disabled={savingSponsor}
            />
          </label>
          <label className="nitt-admin__field">
            <span>Sponsorship level</span>
            <input
              maxLength={100}
              value={sponsorForm.sponsorship_level}
              onChange={(inputEvent) =>
                setSponsorForm((form) => ({
                  ...form,
                  sponsorship_level: inputEvent.target.value,
                }))
              }
              required
              disabled={savingSponsor}
            />
          </label>
          <label className="nitt-admin__field">
            <span>Contact person</span>
            <input
              maxLength={250}
              value={sponsorForm.contact_person}
              onChange={(inputEvent) =>
                setSponsorForm((form) => ({ ...form, contact_person: inputEvent.target.value }))
              }
              disabled={savingSponsor}
            />
          </label>
          <label className="nitt-admin__field">
            <span>Contact email</span>
            <input
              type="email"
              maxLength={320}
              value={sponsorForm.contact_email}
              onChange={(inputEvent) =>
                setSponsorForm((form) => ({ ...form, contact_email: inputEvent.target.value }))
              }
              disabled={savingSponsor}
            />
          </label>
          <label className="nitt-admin__field">
            <span>Contact phone</span>
            <input
              type="tel"
              maxLength={50}
              value={sponsorForm.contact_phone}
              onChange={(inputEvent) =>
                setSponsorForm((form) => ({ ...form, contact_phone: inputEvent.target.value }))
              }
              disabled={savingSponsor}
            />
          </label>
          <label className="nitt-admin__field">
            <span>Sponsorship amount (₹, optional)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={sponsorForm.sponsorship_amount}
              onChange={(inputEvent) =>
                setSponsorForm((form) => ({
                  ...form,
                  sponsorship_amount: inputEvent.target.value,
                }))
              }
              disabled={savingSponsor}
            />
          </label>
          <label className="nitt-admin__field event-form-grid__description">
            <span>Notes</span>
            <textarea
              maxLength={2000}
              value={sponsorForm.notes}
              onChange={(inputEvent) =>
                setSponsorForm((form) => ({ ...form, notes: inputEvent.target.value }))
              }
              disabled={savingSponsor}
            />
          </label>
        </div>
        <div className="event-sessions-form__actions">
          {editingSponsorId && (
            <button
              className="nitt-admin__button nitt-admin__button--quiet"
              type="button"
              disabled={savingSponsor}
              onClick={resetSponsorForm}
            >
              Cancel
            </button>
          )}
          <button
            className="nitt-admin__button nitt-admin__button--primary"
            type="submit"
            disabled={savingSponsor}
          >
            {savingSponsor ? "Saving…" : editingSponsorId ? "Save sponsor" : "Add sponsor"}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="hospitality-message" role="status">Loading advertisements and sponsors…</p>
      ) : (
        <>
          <h3 className="event-advertisement-heading">Advertisements</h3>
          {advertisements.length ? (
            <div className="hospitality-grid">
              {advertisements.map((advertisement) => (
                <article className="hospitality-card" key={advertisement.ad_id}>
                  <dl className="hospitality-card__details">
                    <div><dt>Platform</dt><dd>{advertisement.platform}</dd></div>
                    <div><dt>Target audience</dt><dd>{advertisement.target_audience || "Not specified"}</dd></div>
                    <div><dt>Publish date</dt><dd>{formatEventDate(advertisement.publish_date)}</dd></div>
                  </dl>
                  {advertisement.media_url && (
                    <div className="event-advertisement-media">
                      {advertisement.media_content_type?.startsWith("video/") ? (
                        <video controls preload="metadata" src={advertisement.media_url}>
                          Your browser does not support video playback.
                        </video>
                      ) : (
                        <img src={advertisement.media_url} alt={advertisement.media_file_name || "Advertisement poster"} />
                      )}
                      <p>{advertisement.media_file_name}</p>
                    </div>
                  )}
                  {advertisement.media_error && (
                    <p className="hospitality-message hospitality-message--error" role="status">
                      {advertisement.media_error}
                    </p>
                  )}
                  <div className="event-session-card__actions">
                    {advertisement.media_path && (
                      <button
                        className="nitt-admin__button nitt-admin__button--quiet"
                        type="button"
                        disabled={busyRecord !== ""}
                        onClick={() => deleteAdvertisementMedia(advertisement)}
                      >
                        {busyRecord === `media-${advertisement.ad_id}` ? "Removing…" : "Remove media"}
                      </button>
                    )}
                    <button
                      className="nitt-admin__button nitt-admin__button--quiet"
                      type="button"
                      disabled={savingAd || busyRecord !== ""}
                      onClick={() => startEditingAd(advertisement)}
                    >
                      Edit
                    </button>
                    <button
                      className="nitt-admin__button nitt-admin__button--danger"
                      type="button"
                      disabled={busyRecord !== ""}
                      onClick={() => deleteAdvertisement(advertisement)}
                    >
                      {busyRecord === `ad-${advertisement.ad_id}` ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="hospitality-message">No advertisements have been added for this event.</p>
          )}

          <h3 className="event-advertisement-heading">Event sponsors</h3>
          {sponsors.length ? (
            <div className="hospitality-grid">
              {sponsors.map((sponsor) => (
                <article className="hospitality-card" key={sponsor.sponsor_id}>
                  <dl className="hospitality-card__details">
                    <div><dt>Sponsor</dt><dd>{sponsor.sponsor_name}</dd></div>
                    <div><dt>Level</dt><dd>{sponsor.sponsorship_level}</dd></div>
                    <div><dt>Contact person</dt><dd>{sponsor.contact_person || "Not provided"}</dd></div>
                    <div><dt>Email</dt><dd>{sponsor.contact_email || "Not provided"}</dd></div>
                    <div><dt>Phone</dt><dd>{sponsor.contact_phone || "Not provided"}</dd></div>
                    <div><dt>Amount</dt><dd>{formatAmount(sponsor.sponsorship_amount)}</dd></div>
                    {sponsor.notes && <div><dt>Notes</dt><dd>{sponsor.notes}</dd></div>}
                  </dl>
                  <div className="event-session-card__actions">
                    <button
                      className="nitt-admin__button nitt-admin__button--quiet"
                      type="button"
                      disabled={savingSponsor || busyRecord !== ""}
                      onClick={() => {
                        setEditingSponsorId(sponsor.sponsor_id);
                        setSponsorForm(sponsorFormForRecord(sponsor));
                        setError("");
                        setNotice("");
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="nitt-admin__button nitt-admin__button--danger"
                      type="button"
                      disabled={busyRecord !== ""}
                      onClick={() => deleteSponsor(sponsor)}
                    >
                      {busyRecord === `sponsor-${sponsor.sponsor_id}` ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="hospitality-message">No sponsors have been added for this event.</p>
          )}
        </>
      )}
    </section>
  );
}
