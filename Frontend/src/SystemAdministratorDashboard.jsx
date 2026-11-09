import { useEffect, useId, useMemo, useRef, useState } from "react";
import logo from "./assets/nitt-logo1.jfif";

const assignableRoles = ["student", "event organizer", "admin"];
const filterRoles = assignableRoles;
const emptyForm = {
  FirstName: "",
  LastName: "",
  EmailID: "",
  role: assignableRoles[0],
  is_active: true,
};

function MenuSelect({ label, value, onChange, options, compact = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [placement, setPlacement] = useState("below");
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const selectId = useId();
  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    if (!isOpen) return undefined;

    function closeOnOutsideClick(event) {
      if (!menuRef.current?.contains(event.target)) setIsOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [isOpen]);

  function focusOption(index) {
    const optionElements = menuRef.current?.querySelectorAll('[role="option"]');
    if (!optionElements?.length) return;
    const targetIndex = (index + optionElements.length) % optionElements.length;
    optionElements[targetIndex].focus();
  }

  function openMenu() {
    const triggerBounds = triggerRef.current?.getBoundingClientRect();
    if (triggerBounds) {
      const menuHeight = Math.min(
        220,
        window.innerHeight * 0.45,
        options.length * 36 + 10
      );
      const spaceBelow = window.innerHeight - triggerBounds.bottom;
      const spaceAbove = triggerBounds.top;
      setPlacement(
        spaceBelow < menuHeight && spaceAbove > spaceBelow ? "above" : "below"
      );
    }
    setIsOpen(true);
  }

  function chooseOption(optionValue) {
    onChange(optionValue);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      className={`nitt-admin__menu-select${compact ? " nitt-admin__menu-select--compact" : ""}`}
      ref={menuRef}
    >
      <button
        className="nitt-admin__role-trigger"
        type="button"
        ref={triggerRef}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={`${selectId}-options`}
        onClick={() => {
          if (isOpen) setIsOpen(false);
          else openMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu();
            requestAnimationFrame(() =>
              focusOption(event.key === "ArrowDown" ? 0 : options.length - 1)
            );
          }
        }}
      >
        <span>{selectedOption?.label ?? ""}</span>
        <span className="nitt-admin__role-chevron" aria-hidden="true" />
      </button>
      {isOpen && (
        <div
          className={`nitt-admin__role-menu nitt-admin__role-menu--${placement}`}
          id={`${selectId}-options`}
          role="listbox"
          aria-label={label}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setIsOpen(false);
              triggerRef.current?.focus();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const optionElements = [...menuRef.current.querySelectorAll('[role="option"]')];
              const currentIndex = optionElements.indexOf(document.activeElement);
              focusOption(currentIndex + (event.key === "ArrowDown" ? 1 : -1));
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              focusOption(event.key === "Home" ? 0 : options.length - 1);
            } else if (event.key === "Enter" || event.key === " ") {
              const optionValue = document.activeElement?.dataset.value;
              if (optionValue !== undefined) {
                event.preventDefault();
                chooseOption(optionValue);
              }
            }
          }}
        >
          {options.map((option) => (
            <button
              className="nitt-admin__role-option"
              type="button"
              role="option"
              aria-selected={value === option.value}
              data-value={option.value}
              key={option.value}
              onClick={() => chooseOption(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/*
 * API integration notes (based only on the supplied schema and Backend/main.py):
 * - For the directory, display Person.FirstName, Person.LastName and Person.EmailID,
 *   plus login.role and login.is_active. The current GET /login only returns login
 *   columns (including login_id, person_id, username, role, is_active, last_login,
 *   is_delete and audit fields); no endpoint or response joining Person to login
 *   is defined, so the page does not make up a list-users request.
 * - The existing POST /login requires person_id, username, password_hash, role and
 *   created_by; is_active (default true) and is_delete (default false) are optional.
 *   It only creates a login record, not a Person. The Person schema separately marks
 *   FirstName, LastName, EmailID, PhoneNumber, Gender, PersonType, IsInternal and
 *   Address as required; DepartmentID is an optional foreign key. No Person-create
 *   route, id-generation rule, username/email mapping, or combined response is defined.
 *   Keep this prototype local until those API contracts are supplied.
 * - role values are strings in the backend, without an enum constraint. This UI
 *   offers only student, event organizer and admin for assignment; system administrator
 *   is kept out of the form because that account is already provisioned.
 */
export default function SystemAdministratorDashboard() {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingEmail, setEditingEmail] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return users.filter((user) => {
      const matchesRole = !selectedRole || user.role === selectedRole;
      const name = `${user.FirstName} ${user.LastName}`.toLowerCase();
      const matchesSearch =
        !normalizedQuery ||
        name.includes(normalizedQuery) ||
        user.EmailID.toLowerCase().includes(normalizedQuery);
      return matchesRole && matchesSearch;
    });
  }, [query, selectedRole, users]);

  function openAddForm() {
    setFormOpen(true);
    setEditingEmail(null);
    setForm({ ...emptyForm });
    setFormError("");
  }

  function openEditForm(user) {
    setFormOpen(true);
    setEditingEmail(user.EmailID);
    setForm({
      FirstName: user.FirstName,
      LastName: user.LastName,
      EmailID: user.EmailID,
      role: user.role,
      is_active: user.is_active,
    });
    setFormError("");
  }

  function closeForm() {
    setFormOpen(false);
    setEditingEmail(null);
    setFormError("");
  }

  function saveUser(event) {
    event.preventDefault();
    setFormError("");

    const email = form.EmailID.trim();
    const duplicate = users.some(
      (user) =>
        user.EmailID.toLowerCase() === email.toLowerCase() &&
        user.EmailID !== editingEmail
    );
    if (duplicate) {
      setFormError("EmailID must be unique.");
      return;
    }

    const savedUser = {
      FirstName: form.FirstName.trim(),
      LastName: form.LastName.trim(),
      EmailID: email,
      role: form.role,
      is_active: form.is_active,
    };

    if (editingEmail) {
      setUsers((currentUsers) =>
        currentUsers.map((user) =>
          user.EmailID === editingEmail ? savedUser : user
        )
      );
    } else {
      setUsers((currentUsers) => [...currentUsers, savedUser]);
    }
    closeForm();
  }

  function deleteUser(user) {
    const confirmed = window.confirm(
      `Delete ${user.FirstName} ${user.LastName} (${user.EmailID}) from this prototype list?`
    );
    if (!confirmed) return;

    setUsers((currentUsers) =>
      currentUsers.filter((currentUser) => currentUser.EmailID !== user.EmailID)
    );
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
        <div className="nitt-admin__profile">System administrator</div>
      </header>

      <section className="nitt-admin__content" aria-labelledby="users-heading">
        <div className="nitt-admin__eyebrow">Administration</div>
        <div className="nitt-admin__heading">
          <div>
            <h1 id="users-heading">User directory</h1>
            <p>Review accounts and assign portal roles.</p>
          </div>
          <button
            className="nitt-admin__button nitt-admin__button--primary"
            type="button"
            onClick={openAddForm}
          >
            Add user
          </button>
        </div>

        <p className="nitt-admin__notice" role="status">
          Prototype mode: user changes are held only in this page and are lost when
          it reloads. The supplied backend has no joined user-list or user-management API.
        </p>

        <div className="nitt-admin__toolbar">
          <div className="nitt-admin__count">
            {filteredUsers.length} of {users.length}{" "}
            {users.length === 1 ? "user" : "users"}
          </div>
          <div className="nitt-admin__filters">
            <label>
              <span className="sr-only">Search users by name or email</span>
              <input
                className="nitt-admin__search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name or email"
              />
            </label>
            <MenuSelect
              label="Filter users by role"
              compact
              value={selectedRole}
              onChange={setSelectedRole}
              options={[
                { value: "", label: "All roles" },
                ...filterRoles.map((role) => ({ value: role, label: role })),
              ]}
            />
          </div>
        </div>

        <div className="nitt-admin__table-wrap">
          <table className="nitt-admin__table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td className="nitt-admin__empty" colSpan="5">
                    <strong>{users.length ? "No matching users" : "No users to display"}</strong>
                    {users.length
                      ? "Try another name, email, or role filter."
                      : "Add a user to try the local prototype controls."}
                  </td>
                </tr>
              ) : filteredUsers.map((user) => (
                <tr key={user.EmailID}>
                  <td className="nitt-admin__name">
                    {user.FirstName} {user.LastName}
                  </td>
                  <td className="nitt-admin__email">{user.EmailID}</td>
                  <td>{user.role}</td>
                  <td>
                    <span className={`nitt-admin__status${user.is_active ? "" : " nitt-admin__status--inactive"}`}>
                      {user.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <div className="nitt-admin__actions">
                      <button
                        className="nitt-admin__action"
                        type="button"
                        onClick={() => openEditForm(user)}
                      >
                        Edit
                      </button>
                      <button
                        className="nitt-admin__action nitt-admin__action--delete"
                        type="button"
                        onClick={() => deleteUser(user)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
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
            className="nitt-admin__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-form-title"
          >
            <h2 id="user-form-title">{editingEmail ? "Edit user" : "Add user"}</h2>
            <p className="nitt-admin__dialog-intro">
              Changes are local to this page and will not be saved to the backend.
            </p>
            <form onSubmit={saveUser}>
              <div className="nitt-admin__form-grid">
                <label className="nitt-admin__field">
                  <span>FirstName</span>
                  <input
                    autoComplete="given-name"
                    autoFocus
                    value={form.FirstName}
                    onChange={(event) => setForm({ ...form, FirstName: event.target.value })}
                    required
                  />
                </label>
                <label className="nitt-admin__field">
                  <span>LastName</span>
                  <input
                    autoComplete="family-name"
                    value={form.LastName}
                    onChange={(event) => setForm({ ...form, LastName: event.target.value })}
                    required
                  />
                </label>
                <label className="nitt-admin__field nitt-admin__field--wide">
                  <span>EmailID</span>
                  <input
                    type="email"
                    autoComplete="email"
                    value={form.EmailID}
                    onChange={(event) => setForm({ ...form, EmailID: event.target.value })}
                    required
                  />
                </label>
                <div className="nitt-admin__field">
                  <span>role</span>
                  <MenuSelect
                    label="role"
                    value={form.role}
                    onChange={(role) => setForm({ ...form, role })}
                    options={assignableRoles.map((role) => ({ value: role, label: role }))}
                  />
                </div>
                <div className="nitt-admin__field">
                  <span>is_active</span>
                  <MenuSelect
                    label="is_active"
                    value={form.is_active ? "true" : "false"}
                    onChange={(active) => setForm({ ...form, is_active: active === "true" })}
                    options={[
                      { value: "true", label: "Active" },
                      { value: "false", label: "Inactive" },
                    ]}
                  />
                </div>
              </div>
              {formError && <p className="nitt-admin__notice" role="alert">{formError}</p>}
              <div className="nitt-admin__dialog-actions">
                <button
                  className="nitt-admin__button nitt-admin__button--quiet"
                  type="button"
                  onClick={closeForm}
                >
                  Cancel
                </button>
                <button className="nitt-admin__button nitt-admin__button--primary" type="submit">
                  Save locally
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
