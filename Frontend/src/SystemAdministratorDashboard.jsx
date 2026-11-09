import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import logo from "./assets/nitt-logo1.jfif";

const API_URL = "/api/system-administrator/internal-people";
const DEPARTMENTS_URL = "/api/system-administrator/departments";
const AUDIT_ACTOR =
  window.sessionStorage.getItem("loginUsername") || "System Administrator";
const personRoles = [
  { value: "System Administrator", label: "System Administrator" },
  { value: "Super Admin", label: "Super Admin" },
  { value: "Event Organizer", label: "Event Organizer" },
  { value: "Event Committee Member", label: "Event Committee Member" },
  { value: "User", label: "User" },
];
const legacyPersonRoleLabels = { user: "User", admin: "Admin" };

const emptyForm = {
  first_name: "",
  last_name: "",
  email_id: "",
  phone_number: "",
  gender: "",
  person_type: "User",
  department_id: "",
  address: "",
};

async function requestApi(url, options) {
  const response = await fetch(url, options);
  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }

  if (!response.ok) {
    const detail = result?.detail;
    const message = Array.isArray(detail)
      ? detail.map((issue) => issue.msg ?? "Invalid input").join(" ")
      : detail;
    throw new Error(
      typeof message === "string" && message
        ? message
        : "The request could not be completed."
    );
  }

  return result;
}

function toForm(person) {
  return {
    first_name: person.first_name ?? "",
    last_name: person.last_name ?? "",
    email_id: person.email_id ?? "",
    phone_number: person.phone_number ?? "",
    gender: person.gender ?? "",
    person_type: person.person_type ?? "",
    department_id: person.department_id == null ? "" : String(person.department_id),
    address: person.address ?? "",
  };
}

export default function SystemAdministratorDashboard() {
  const navigate = useNavigate();
  const [people, setPeople] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [departmentError, setDepartmentError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingPersonId, setEditingPersonId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyPersonId, setBusyPersonId] = useState(null);
  const [pageError, setPageError] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;

    async function fetchPeople() {
      try {
        const result = await requestApi(API_URL);
        if (!Array.isArray(result.data)) {
          throw new Error("The server response did not contain a people list.");
        }
        if (active) setPeople(result.data);
      } catch (error) {
        if (active) setPageError(error.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    async function fetchDepartments() {
      try {
        const result = await requestApi(DEPARTMENTS_URL);
        if (!Array.isArray(result.data)) {
          throw new Error("The server response did not contain a department list.");
        }
        if (active) setDepartments(result.data);
      } catch (error) {
        if (active) setDepartmentError(error.message);
      }
    }

    fetchPeople();
    fetchDepartments();
    return () => {
      active = false;
    };
  }, []);

  const loadPeople = useCallback(async () => {
    setPageError("");
    setLoading(true);
    try {
      const result = await requestApi(API_URL);
      if (!Array.isArray(result.data)) {
        throw new Error("The server response did not contain a people list.");
      }
      setPeople(result.data);
    } catch (error) {
      setPageError(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const personTypes = useMemo(
    () => [...new Set(people.map((person) => person.person_type).filter(Boolean))].sort(),
    [people]
  );

  const filteredPeople = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return people.filter((person) => {
      const matchesType = !selectedType || person.person_type === selectedType;
      const searchableFields = [
        person.first_name,
        person.last_name,
        person.email_id,
        person.phone_number,
        person.person_type,
        person.address,
        person.department_id,
      ];
      const matchesSearch =
        !normalizedQuery ||
        searchableFields.some((value) =>
          String(value ?? "").toLowerCase().includes(normalizedQuery)
        );
      return matchesType && matchesSearch;
    });
  }, [people, query, selectedType]);

  function openAddForm() {
    setEditingPersonId(null);
    setForm({ ...emptyForm });
    setFormError("");
    setFormOpen(true);
  }

  function openEditForm(person) {
    setEditingPersonId(person.person_id);
    setForm(toForm(person));
    setFormError("");
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditingPersonId(null);
    setFormError("");
  }

  async function savePerson(event) {
    event.preventDefault();
    setFormError("");
    setSaving(true);

    const payload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email_id: form.email_id.trim(),
      phone_number: form.phone_number.trim(),
      gender: form.gender.trim(),
      person_type: form.person_type.trim(),
      department_id: form.department_id === "" ? null : Number(form.department_id),
      address: form.address.trim(),
      ...(editingPersonId
        ? { updated_by: AUDIT_ACTOR }
        : { created_by: AUDIT_ACTOR }),
    };

    try {
      await requestApi(
        editingPersonId ? `${API_URL}/${editingPersonId}` : API_URL,
        {
          method: editingPersonId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      setFormOpen(false);
      setEditingPersonId(null);
      await loadPeople();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function deletePerson(person) {
    const fullName = `${person.first_name} ${person.last_name}`.trim();
    if (!window.confirm(`Delete ${fullName} (${person.email_id}) from the directory?`)) {
      return;
    }

    setPageError("");
    setBusyPersonId(person.person_id);
    try {
      await requestApi(`${API_URL}/${person.person_id}`, { method: "DELETE" });
      await loadPeople();
    } catch (error) {
      setPageError(error.message);
    } finally {
      setBusyPersonId(null);
    }
  }

  function updateField(field, value) {
    setForm((currentForm) => ({ ...currentForm, [field]: value }));
  }

  function logout() {
    window.sessionStorage.removeItem("loginUsername");
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
          <div className="nitt-admin__profile">Signed in as {AUDIT_ACTOR}</div>
          <button
            className="nitt-admin__button nitt-admin__button--quiet"
            type="button"
            onClick={logout}
          >
            Logout
          </button>
        </div>
      </header>

      <section className="nitt-admin__content" aria-labelledby="people-heading">
        <div className="nitt-admin__eyebrow">Administration</div>
        <div className="nitt-admin__heading">
          <div>
            <h1 id="people-heading">User directory</h1>
            <p>View and maintain people records stored in the database.</p>
          </div>
          <button
            className="nitt-admin__button nitt-admin__button--primary"
            type="button"
            onClick={openAddForm}
          >
            Add person
          </button>
        </div>

        {departmentError && (
          <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
            Departments could not be loaded: {departmentError}
          </p>
        )}
        {pageError && (
          <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
            {pageError}
            <button
              className="nitt-admin__action"
              type="button"
              onClick={loadPeople}
              disabled={loading}
            >
              Retry
            </button>
          </p>
        )}

        <div className="nitt-admin__toolbar">
          <div className="nitt-admin__count">
            {loading ? "Loading people…" : `${filteredPeople.length} of ${people.length} people`}
          </div>
          <div className="nitt-admin__filters">
            <label>
              <span className="sr-only">Search people</span>
              <input
                className="nitt-admin__search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, email, phone…"
              />
            </label>
            <label className="nitt-admin__filter-select">
              <span className="sr-only">Filter by person type</span>
              <select
                className="nitt-admin__search"
                value={selectedType}
                onChange={(event) => setSelectedType(event.target.value)}
              >
                <option value="">All person types</option>
                {personTypes.map((personType) => (
                  <option key={personType} value={personType}>
                    {personType}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="nitt-admin__table-wrap">
          <table className="nitt-admin__table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Phone</th>
                <th scope="col">Gender</th>
                <th scope="col">Role</th>
                <th scope="col">Department</th>
                <th scope="col">Address</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="nitt-admin__empty" colSpan="8">Loading directory…</td>
                </tr>
              ) : filteredPeople.length === 0 ? (
                <tr>
                  <td className="nitt-admin__empty" colSpan="8">
                    <strong>{people.length ? "No matching people" : "No people to display"}</strong>
                    {people.length
                      ? "Try another search or person type."
                      : "Add a person to create the first directory record."}
                  </td>
                </tr>
              ) : (
                filteredPeople.map((person) => (
                  <tr key={person.person_id}>
                    <td className="nitt-admin__name">
                      {person.first_name} {person.last_name}
                    </td>
                    <td className="nitt-admin__email">{person.email_id}</td>
                    <td>{person.phone_number}</td>
                    <td>{person.gender}</td>
                    <td>
                      {personRoles.find((role) => role.value === person.person_type)?.label ??
                        legacyPersonRoleLabels[person.person_type] ??
                        person.person_type}
                    </td>
                    <td>
                      {departments.find(
                        (department) => department.department_id === person.department_id
                      )?.department_name ?? person.department_id ?? "—"}
                    </td>
                    <td>{person.address}</td>
                    <td>
                      <div className="nitt-admin__actions">
                        <button
                          className="nitt-admin__action"
                          type="button"
                          onClick={() => openEditForm(person)}
                          disabled={busyPersonId === person.person_id}
                        >
                          Edit
                        </button>
                        <button
                          className="nitt-admin__action nitt-admin__action--delete"
                          type="button"
                          onClick={() => deletePerson(person)}
                          disabled={busyPersonId === person.person_id}
                        >
                          {busyPersonId === person.person_id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {formOpen && (
        <div
          className="nitt-admin__overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeForm();
          }}
        >
          <section
            className="nitt-admin__dialog nitt-admin__dialog--person"
            role="dialog"
            aria-modal="true"
            aria-labelledby="person-form-title"
          >
            <h2 id="person-form-title">{editingPersonId ? "Edit person" : "Add person"}</h2>
            <p className="nitt-admin__dialog-intro">
              Enter the person details required by the database.
            </p>
            <form onSubmit={savePerson}>
              <div className="nitt-admin__form-grid">
                <label className="nitt-admin__field">
                  <span>First name</span>
                  <input
                    autoComplete="given-name"
                    autoFocus
                    maxLength={100}
                    value={form.first_name}
                    onChange={(event) => updateField("first_name", event.target.value)}
                    required
                    disabled={saving}
                  />
                </label>
                <label className="nitt-admin__field">
                  <span>Last name</span>
                  <input
                    autoComplete="family-name"
                    maxLength={100}
                    value={form.last_name}
                    onChange={(event) => updateField("last_name", event.target.value)}
                    required
                    disabled={saving}
                  />
                </label>
                <label className="nitt-admin__field">
                  <span>Email</span>
                  <input
                    type="email"
                    autoComplete="email"
                    maxLength={150}
                    value={form.email_id}
                    onChange={(event) => updateField("email_id", event.target.value)}
                    required
                    disabled={saving}
                  />
                </label>
                <label className="nitt-admin__field">
                  <span>Phone number</span>
                  <input
                    type="tel"
                    autoComplete="tel"
                    maxLength={20}
                    value={form.phone_number}
                    onChange={(event) => updateField("phone_number", event.target.value)}
                    required
                    disabled={saving}
                  />
                </label>
                <label className="nitt-admin__field">
                  <span>Gender</span>
                  <input
                    maxLength={10}
                    value={form.gender}
                    onChange={(event) => updateField("gender", event.target.value)}
                    required
                    disabled={saving}
                  />
                </label>
                <label className="nitt-admin__field">
                  <span>Role</span>
                  <select
                    value={form.person_type}
                    onChange={(event) => updateField("person_type", event.target.value)}
                    required
                    disabled={saving}
                  >
                    {form.person_type &&
                      !personRoles.some((role) => role.value === form.person_type) && (
                        <option value={form.person_type}>
                          {legacyPersonRoleLabels[form.person_type] ?? form.person_type} (existing)
                        </option>
                      )}
                    {personRoles.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="nitt-admin__field">
                  <span>Department <span className="nitt-admin__optional">(optional)</span></span>
                  <select
                    value={form.department_id}
                    onChange={(event) => updateField("department_id", event.target.value)}
                    disabled={saving || Boolean(departmentError)}
                  >
                    <option value="">
                      {departments.length ? "No department" : "No departments available"}
                    </option>
                    {departments.map((department) => (
                      <option
                        key={department.department_id}
                        value={department.department_id}
                      >
                        {department.department_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="nitt-admin__field nitt-admin__field--wide">
                  <span>Address</span>
                  <textarea
                    autoComplete="street-address"
                    maxLength={500}
                    rows={3}
                    value={form.address}
                    onChange={(event) => updateField("address", event.target.value)}
                    required
                    disabled={saving}
                  />
                </label>
              </div>
              {formError && <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">{formError}</p>}
              <div className="nitt-admin__dialog-actions">
                <button
                  className="nitt-admin__button nitt-admin__button--quiet"
                  type="button"
                  onClick={closeForm}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  className="nitt-admin__button nitt-admin__button--primary"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? "Saving…" : editingPersonId ? "Save changes" : "Add person"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
