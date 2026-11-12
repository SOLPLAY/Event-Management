const API_URL = "/api/user";

export class UserApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "UserApiError";
    this.status = status;
  }
}

export async function requestUserApi(path, options = {}) {
  const token = window.sessionStorage.getItem("accessToken");
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new UserApiError(
      "Unable to connect to the server. Please make sure the backend is running.",
      0
    );
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new UserApiError("The server returned an invalid response.", response.status);
  }

  if (!response.ok) {
    const detail = result?.detail;
    const message = Array.isArray(detail)
      ? detail.map((issue) => issue.msg ?? "Invalid input").join(" ")
      : detail;
    throw new UserApiError(
      typeof message === "string" && message
        ? message
        : "The request could not be completed.",
      response.status
    );
  }

  return result;
}

export const eventViews = [
  { value: "current", label: "Upcoming & ongoing" },
  { value: "past", label: "Past events" },
  { value: "all", label: "All events" },
];

export function matchesView(event, view) {
  if (view === "all") return true;
  const past = event.phase === "Ended";
  return view === "past" ? past : !past;
}

export function filterUserEvents(events, query, view) {
  const normalizedQuery = query.trim().toLowerCase();
  return events.filter((event) => {
    if (!matchesView(event, view)) return false;
    if (!normalizedQuery) return true;
    return [event.name, event.type, event.description, ...(event.organizers ?? [])].some(
      (value) => String(value ?? "").toLowerCase().includes(normalizedQuery)
    );
  });
}

export function formatDateTime(value) {
  if (!value) return "Not set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not set";
  return parsed.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
