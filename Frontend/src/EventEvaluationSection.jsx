import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { requestEventApi } from "./eventApi";

const emptyForm = {
  score: "",
  feedback_rating: "",
  certificate_issued: false,
};

function formForEvaluation(evaluation) {
  return evaluation
    ? {
        score: evaluation.score ?? "",
        feedback_rating: evaluation.feedback_rating ?? "",
        certificate_issued: evaluation.certificate_issued === true,
      }
    : { ...emptyForm };
}

export default function EventEvaluationSection({ event }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRegistrationId = searchParams.get("registration_id");
  const [registrations, setRegistrations] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const [form, setForm] = useState({ ...emptyForm });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const registrationsPath = `/organizer/events/${event.event_id}/registrations`;
  const evaluationsPath = `/organizer/events/${event.event_id}/evaluations`;
  const selectedRegistration = registrations.find(
    (record) => String(record.registration_id) === requestedRegistrationId
  );
  const evaluation = evaluations.find(
    (record) => String(record.registration_id) === requestedRegistrationId
  );

  useEffect(() => {
    let active = true;
    Promise.all([
      requestEventApi(registrationsPath),
      requestEventApi(evaluationsPath),
    ])
      .then(([registrationsResult, evaluationsResult]) => {
        if (
          !Array.isArray(registrationsResult.data) ||
          !Array.isArray(evaluationsResult.data)
        ) {
          throw new Error("The server response did not contain valid evaluation records.");
        }
        if (active) {
          setRegistrations(registrationsResult.data);
          setEvaluations(evaluationsResult.data);
          const registration = registrationsResult.data.find(
            (record) => String(record.registration_id) === requestedRegistrationId
          );
          const selectedEvaluation = evaluationsResult.data.find(
            (record) => String(record.registration_id) === requestedRegistrationId
          );
          setForm(
            registration ? formForEvaluation(selectedEvaluation) : { ...emptyForm }
          );
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
  }, [evaluationsPath, registrationsPath, requestedRegistrationId]);

  function selectRegistration(registration) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", "workspace");
    nextParams.set("event_id", String(event.event_id));
    nextParams.set("section", "evaluation");
    nextParams.set("registration_id", String(registration.registration_id));
    setSearchParams(nextParams);

    const selectedEvaluation = evaluations.find(
      (record) =>
        String(record.registration_id) === String(registration.registration_id)
    );
    setForm(formForEvaluation(selectedEvaluation));
    setError("");
    setNotice("");
  }

  function updateField(field, value) {
    setForm((currentForm) => ({ ...currentForm, [field]: value }));
  }

  async function saveEvaluation(submitEvent) {
    submitEvent.preventDefault();
    if (!selectedRegistration) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await requestEventApi(
        evaluation
          ? `${evaluationsPath}/${evaluation.evaluation_id}`
          : evaluationsPath,
        {
          method: evaluation ? "PUT" : "POST",
          body: JSON.stringify({
            ...(evaluation
              ? {}
              : { registration_id: selectedRegistration.registration_id }),
            score: form.score === "" ? null : Number(form.score),
            feedback_rating:
              form.feedback_rating === "" ? null : Number(form.feedback_rating),
            certificate_issued: form.certificate_issued,
          }),
        }
      );
      const savedEvaluation = {
        ...evaluation,
        ...result.data,
        person_name: selectedRegistration.person_name,
      };
      setEvaluations((currentEvaluations) =>
        evaluation
          ? currentEvaluations.map((record) =>
              String(record.evaluation_id) === String(evaluation.evaluation_id)
                ? savedEvaluation
                : record
            )
          : [...currentEvaluations, savedEvaluation]
      );
      setNotice(evaluation ? "Evaluation updated." : "Evaluation created.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvaluation() {
    if (!evaluation || !selectedRegistration) return;
    if (!window.confirm(`Delete the evaluation for ${selectedRegistration.person_name}?`)) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await requestEventApi(
        `${evaluationsPath}/${evaluation.evaluation_id}`,
        { method: "DELETE" }
      );
      setEvaluations((currentEvaluations) =>
        currentEvaluations.filter(
          (record) =>
            String(record.evaluation_id) !== String(evaluation.evaluation_id)
        )
      );
      setForm({ ...emptyForm });
      setNotice("Evaluation deleted.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
      <div className="event-workspace-panel__eyebrow">{event.name}</div>
      <h2 id="event-workspace-heading">Evaluation</h2>
      <p>Evaluate registered students, update scores, and manage certificate status.</p>
      {error && (
        <p className="hospitality-message hospitality-message--error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="hospitality-message" role="status">{notice}</p>}
      {loading ? (
        <p className="hospitality-message" role="status">Loading evaluation details…</p>
      ) : error ? null : registrations.length ? (
        <div className="registration-table-wrap">
          <table className="registration-table">
            <thead>
              <tr>
                <th scope="col">Student</th>
                <th scope="col">Score</th>
                <th scope="col">Feedback rating</th>
                <th scope="col">Certificate</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((registration) => {
                const record = evaluations.find(
                  (item) =>
                    String(item.registration_id) ===
                    String(registration.registration_id)
                );
                return (
                  <tr key={registration.registration_id}>
                    <td>{registration.person_name}</td>
                    <td>{record?.score ?? "Not scored"}</td>
                    <td>{record?.feedback_rating ?? "Not rated"}</td>
                    <td>
                      {record
                        ? record.certificate_issued
                          ? "Issued"
                          : "Not issued"
                        : "Not recorded"}
                    </td>
                    <td>
                      <button
                        className="nitt-admin__button nitt-admin__button--quiet"
                        type="button"
                        onClick={() => selectRegistration(registration)}
                      >
                        {record ? "Edit" : "Evaluate"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="hospitality-message">
          No students have registered for this event yet.
        </p>
      )}

      {selectedRegistration && !loading && (
        <form className="event-evaluation-form" onSubmit={saveEvaluation}>
          <h3>
            {evaluation ? "Update evaluation" : "Evaluate"}:{" "}
            {selectedRegistration.person_name}
          </h3>
          <div className="event-form-grid">
            <label className="nitt-admin__field">
              <span>Score</span>
              <input
                type="number"
                step="any"
                value={form.score}
                onChange={(inputEvent) => updateField("score", inputEvent.target.value)}
                disabled={saving}
              />
            </label>
            <label className="nitt-admin__field">
              <span>Feedback rating</span>
              <input
                type="number"
                step="1"
                value={form.feedback_rating}
                onChange={(inputEvent) =>
                  updateField("feedback_rating", inputEvent.target.value)
                }
                disabled={saving}
              />
            </label>
            <label className="nitt-admin__field evaluation-certificate">
              <input
                type="checkbox"
                checked={form.certificate_issued}
                onChange={(inputEvent) =>
                  updateField("certificate_issued", inputEvent.target.checked)
                }
                disabled={saving}
              />
              <span>Certificate issued</span>
            </label>
          </div>
          <div className="event-sessions-form__actions">
            {evaluation && (
              <button
                className="nitt-admin__button nitt-admin__button--danger"
                type="button"
                disabled={saving}
                onClick={deleteEvaluation}
              >
                Delete evaluation
              </button>
            )}
            <button
              className="nitt-admin__button nitt-admin__button--primary"
              type="submit"
              disabled={saving}
            >
              {saving
                ? "Saving…"
                : evaluation
                  ? "Save changes"
                  : "Create evaluation"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
