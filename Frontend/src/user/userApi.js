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
  { value: "registered", label: "My registrations" },
  { value: "past", label: "Past events" },
  { value: "all", label: "All events" },
];

export function matchesView(event, view) {
  if (view === "all") return true;
  if (view === "registered") return Boolean(event.my_registration);
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

// fee: number (0 = free), or null/undefined when the fee has not been set up.
export function formatFee(fee) {
  if (fee === null || fee === undefined || Number.isNaN(Number(fee))) return "Not set";
  const amount = Number(fee);
  if (amount === 0) return "Free";
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function formatAmount(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

// Today's date as YYYY-MM-DD in the user's own time zone (what <input type="date"> expects).
export function todayLocalIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// 1 -> "1st", 2 -> "2nd", 11 -> "11th" ...
export function ordinal(number) {
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) return String(number ?? "");
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The file could not be read. Please choose it again."));
    reader.readAsDataURL(file);
  });
}

// The evaluation tab remains available before publication; only final results wait
// until the event is complete.
export const eventTabs = [
  { id: "overview", label: "Overview" },
  { id: "schedule", label: "Schedule" },
  { id: "hospitality", label: "Hospitality" },
  { id: "accommodation", label: "My accommodation" },
  { id: "registration", label: "Registration & payment" },
  { id: "evaluation", label: "Evaluations" },
  { id: "results", label: "Results" },
];

export function visibleTabs(event) {
  return eventTabs.filter(
    (tab) =>
      tab.id !== "results" || event?.event_status === "Completed"
  );
}

// Remembers each tab's data for as long as one event page stays open, and shares requests that are
// already in flight (so prefetching a tab and then opening it sends only ONE request).
// Failed requests are not remembered, so Retry really asks again.
export function createTabCache(eventId) {
  const entries = new Map(); // resource -> { promise, data }

  return {
    peek(resource) {
      return entries.get(resource)?.data;
    },
    load(resource) {
      const existing = entries.get(resource);
      if (existing) return existing.promise;
      const entry = { data: undefined, promise: null };
      entry.promise = requestUserApi(`/events/${eventId}/${resource}`)
        .then((result) => {
          if (!result.data || typeof result.data !== "object") {
            throw new Error("The server response was not in the expected format.");
          }
          entry.data = result.data;
          return result.data;
        })
        .catch((error) => {
          entries.delete(resource);
          throw error;
        });
      entries.set(resource, entry);
      return entry.promise;
    },
    invalidate(...resources) {
      resources.forEach((resource) => entries.delete(resource));
    },
  };
}
