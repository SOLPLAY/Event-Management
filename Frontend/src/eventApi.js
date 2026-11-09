const API_URL = "/api/event-management";

export async function requestEventApi(path, options = {}) {
  const token = window.sessionStorage.getItem("accessToken");
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

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

export const eventStatuses = [
  { value: "", label: "All statuses" },
  { value: "Pending", label: "Pending" },
  { value: "Approved", label: "Approved" },
  { value: "Rejected", label: "Reject" },
  { value: "Published", label: "Publish" },
  { value: "Completed", label: "Completed" },
];

export const eventTypes = [
  "Hackathon",
  "Seminar",
  "Workshop",
  "Competition",
  "Symposium",
];

export function formatEventDate(value) {
  if (!value) return "Not set";
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function filterEvents(events, query, selectedStatus) {
  const normalizedQuery = query.trim().toLowerCase();
  return events.filter((event) => {
    if (selectedStatus && event.event_status !== selectedStatus) return false;
    if (!normalizedQuery) return true;
    return [
      event.name,
      event.type,
      event.event_status,
      event.created_by,
      ...(event.organizers ?? []),
    ].some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
  });
}

export function eventPayload(form) {
  return JSON.stringify({
    name: form.name.trim(),
    type: form.type.trim(),
    description: form.description.trim(),
    start_date: form.start_date,
    end_date: form.end_date,
  });
}

export function clearLoginSession() {
  ["loginUsername", "personId", "loginRole", "accessToken"].forEach((key) =>
    window.sessionStorage.removeItem(key)
  );
}
