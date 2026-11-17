const API_URL = "/api/event-management";
const RETRYABLE_GET_STATUSES = new Set([500, 502, 503, 504]);
const GET_RETRY_DELAYS_MS = [300, 700];

function waitBeforeRetry(delay, signal) {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, delay));

  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new Error("The request was cancelled."));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function requestEventApi(path, options = {}) {
  const token = window.sessionStorage.getItem("accessToken");
  const isFormData = options.body instanceof FormData;
  const method = (options.method ?? "GET").toUpperCase();
  const retryDelays = method === "GET" ? GET_RETRY_DELAYS_MS : [];
  const headers = {
    ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await fetch(`${API_URL}${path}`, { ...options, headers });
    } catch (requestError) {
      if (
        attempt < retryDelays.length &&
        !options.signal?.aborted &&
        requestError instanceof TypeError
      ) {
        await waitBeforeRetry(retryDelays[attempt], options.signal);
        continue;
      }
      throw requestError;
    }

    let result;
    try {
      result = await response.json();
    } catch {
      if (
        attempt < retryDelays.length &&
        RETRYABLE_GET_STATUSES.has(response.status)
      ) {
        await waitBeforeRetry(retryDelays[attempt], options.signal);
        continue;
      }
      throw new Error("The server returned an invalid response.");
    }

    if (!response.ok) {
      if (
        attempt < retryDelays.length &&
        RETRYABLE_GET_STATUSES.has(response.status)
      ) {
        await waitBeforeRetry(retryDelays[attempt], options.signal);
        continue;
      }
      const detail = result?.detail;
      const message = Array.isArray(detail)
        ? detail.map((issue) => issue.msg ?? "Invalid input").join(" ")
        : detail;
      const error = new Error(
        typeof message === "string" && message
          ? message
          : "The request could not be completed."
      );
      error.status = response.status;
      throw error;
    }

    return result;
  }
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
  const dateValue = String(value).slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
    ? new Date(`${dateValue}T00:00:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString(undefined, {
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
    fee: form.fee,
  });
}

export function clearLoginSession() {
  ["loginUsername", "personId", "loginRole", "accessToken"].forEach((key) =>
    window.sessionStorage.removeItem(key)
  );
}
