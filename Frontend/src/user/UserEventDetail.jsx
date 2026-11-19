import { useCallback, useEffect, useState } from "react";
import { formatEventDate } from "../eventApi";
import { createTabCache, formatAmount, formatFee, requestUserApi, visibleTabs } from "./userApi";
import {
  AccommodationTab,
  EvaluationScoresTab,
  HospitalityTab,
  PhotographsTab,
  ResultsTab,
  ScheduleTab,
} from "./UserEventTabs";
import UserPaymentPage from "./UserPaymentPage";

async function fetchEvent(eventId) {
  const result = await requestUserApi(`/events/${eventId}`);
  if (!result.data || typeof result.data !== "object") {
    throw new Error("The server response did not contain this event.");
  }
  return result.data;
}

function PaymentStatusLine({ registration }) {
  switch (registration.payment_status) {
    case "Submitted":
      return "Your payment proof has been submitted and is waiting for the organiser to verify it.";
    case "Rejected":
      return "Your last payment proof was rejected. Please check the reason and submit it again.";
    case "Verified":
      return "Your payment has been verified. Your place will be confirmed shortly.";
    default:
      return "You have not submitted your payment yet.";
  }
}

function RegistrationTab({ event, registering, onRegister, onOpenPayment }) {
  const registration = event.my_registration;
  const fee = event.fee;
  const feeKnown = fee !== null && fee !== undefined;
  const isFree = feeKnown && Number(fee) === 0;

  if (registration) {
    const confirmed = registration.status === "Confirmed";
    const paymentButtonLabel =
      registration.payment_status === "Rejected"
        ? "Submit payment again"
        : registration.payment_status === "Submitted" || registration.payment_status === "Verified"
          ? "View payment details"
          : "Go to payment page";

    return (
      <>
        <p className="user-registered">You are registered · {registration.status}</p>
        {confirmed ? (
          <p className="user-detail__muted user-register__hint">
            Your place is confirmed.
            {Number(registration.fee_paid) > 0 && ` Amount paid: ${formatAmount(registration.fee_paid)}.`}
          </p>
        ) : feeKnown && !isFree ? (
          <>
            <p className="user-detail__muted user-register__hint">
              Registration fee: <strong>{formatFee(fee)}</strong>. <PaymentStatusLine registration={registration} />
            </p>
            <button
              className="nitt-admin__button nitt-admin__button--primary user-register__action"
              type="button"
              onClick={onOpenPayment}
            >
              {paymentButtonLabel}
            </button>
          </>
        ) : (
          <p className="user-detail__muted user-register__hint">Your registration is pending.</p>
        )}
      </>
    );
  }

  if (!event.registration_open) {
    return <p className="user-detail__muted">Registration is closed for this event.</p>;
  }

  if (!feeKnown) {
    return (
      <p className="user-detail__muted">
        Registration is not available yet: the fee for this event has not been set up.
      </p>
    );
  }

  return (
    <div className="user-register">
      <div className="user-register__fee">
        <span>Registration fee</span>
        <strong>{formatFee(fee)}</strong>
      </div>
      <button
        className="nitt-admin__button nitt-admin__button--primary"
        type="button"
        onClick={onRegister}
        disabled={registering}
      >
        {registering ? "Registering…" : isFree ? "Register for this event" : "Register and continue to payment"}
      </button>
      {!isFree && (
        <p className="user-detail__muted user-register__hint">
          After registering you will be taken to a payment page where you can pay online and upload
          your transaction details for the organiser to verify.
        </p>
      )}
    </div>
  );
}

function OverviewTab({ event }) {
  return (
    <>
      <p className="user-detail__description">
        {event.description || "No description has been provided for this event."}
      </p>
      <dl className="user-detail__facts">
        <div>
          <dt>Start date</dt>
          <dd>{formatEventDate(event.start_date)}</dd>
        </div>
        <div>
          <dt>End date</dt>
          <dd>{formatEventDate(event.end_date)}</dd>
        </div>
        <div>
          <dt>Registration fee</dt>
          <dd>{formatFee(event.fee)}</dd>
        </div>
        <div>
          <dt>Event type</dt>
          <dd>{event.type || "Event"}</dd>
        </div>
        <div>
          <dt>Organised by</dt>
          <dd>{event.organizers?.length ? event.organizers.join(", ") : "Not listed"}</dd>
        </div>
        <div>
          <dt>Your registration</dt>
          <dd>{event.my_registration ? event.my_registration.status : "Not registered"}</dd>
        </div>
      </dl>
    </>
  );
}

// Mount this with key={eventId} so it starts fresh for every event.
export default function UserEventDetail({
  eventId,
  tab,
  showPayment,
  onTabChange,
  onOpenPayment,
  onClosePayment,
  onBack,
  onAuthError,
  initialEvent,
}) {
  // The list already has most of what the page shows, so the page opens immediately from that card
  // while the full event (sessions, payment state) loads in the background.
  const [event, setEvent] = useState(initialEvent ?? null);
  const [detailLoaded, setDetailLoaded] = useState(false);
  const [loading, setLoading] = useState(!initialEvent);
  const [error, setError] = useState("");
  const [cache] = useState(() => createTabCache(eventId));
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState("");
  const [registerNotice, setRegisterNotice] = useState("");

  useEffect(() => {
    let active = true;

    async function loadEvent() {
      try {
        const data = await fetchEvent(eventId);
        if (active) {
          setEvent(data);
          setDetailLoaded(true);
        }
      } catch (requestError) {
        if (!active) return;
        if (requestError.status === 401) {
          onAuthError();
          return;
        }
        setError(requestError.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadEvent();
    return () => {
      active = false;
    };
  }, [eventId, onAuthError]);

  // Warm the tabs up as soon as the event is known, so opening them is instant.
  const isCompleted = event?.event_status === "Completed";
  useEffect(() => {
    if (!detailLoaded) return;
    const quiet = () => {}; // a failed prefetch is ignored; opening the tab asks again and shows the error
    cache.load("hospitality").catch(quiet);
    cache.load("accommodation").catch(quiet);
    cache.load("photographs").catch(quiet);
    if (isCompleted) cache.load("results").catch(quiet);
  }, [cache, detailLoaded, isCompleted]);

  // Re-read the event quietly (after a payment was submitted, or a 409). Keeps what is on screen on failure.
  const refreshEvent = useCallback(async () => {
    try {
      setEvent(await fetchEvent(eventId));
    } catch {
      /* keep what is on screen */
    }
  }, [eventId]);

  async function handleRegister() {
    if (registering) return;
    setRegistering(true);
    setRegisterError("");
    setRegisterNotice("");

    try {
      const result = await requestUserApi(`/events/${eventId}/register`, { method: "POST" });
      const registration = result.data;
      if (!registration?.status) {
        throw new Error("The server did not confirm the registration. Please check again.");
      }
      setEvent((current) => ({
        ...current,
        my_registration: { status: registration.status, fee_paid: 0, payment_status: null },
      }));
      cache.invalidate("accommodation", "results"); // they depend on being registered
      if (registration.next_step === "payment") {
        onOpenPayment(); // paid event: straight to the payment page
      } else {
        setRegisterNotice(registration.message || "You are registered for this event.");
      }
    } catch (requestError) {
      if (requestError.status === 401) {
        onAuthError();
        return;
      }
      setRegisterError(requestError.message);
      if (requestError.status === 409) {
        // Already registered (another tab) or registration just closed: show the true state.
        await refreshEvent();
      }
    } finally {
      setRegistering(false);
    }
  }

  const tabs = event && !error ? visibleTabs(event) : [];
  const activeTab = tabs.some((item) => item.id === tab) ? tab : "overview";
  const paymentAvailable = Boolean(event?.my_registration) && Number(event?.fee) > 0;

  return (
    <div className="user-detail">
      {!showPayment && (
        <button
          className="nitt-admin__button nitt-admin__button--quiet user-detail__back"
          type="button"
          onClick={onBack}
        >
          ← All events
        </button>
      )}

      {loading && <p className="event-list-message">Loading event…</p>}

      {!loading && error && (
        <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
          {error}
        </p>
      )}

      {!loading && event && !error && showPayment && !detailLoaded && (
        <p className="event-list-message">Loading payment page…</p>
      )}

      {!loading && event && !error && showPayment && detailLoaded && paymentAvailable && (
        <UserPaymentPage
          eventId={eventId}
          onBack={onClosePayment}
          onAuthError={onAuthError}
          onChanged={refreshEvent}
        />
      )}

      {!loading && event && !error && showPayment && detailLoaded && !paymentAvailable && (
        <article className="user-detail__panel">
          <p className="user-detail__muted">
            {event.my_registration
              ? "This event is free, so there is nothing to pay."
              : "Register for this event first to see the payment page."}
          </p>
          <button className="nitt-admin__button nitt-admin__button--quiet" type="button" onClick={onClosePayment}>
            ← Back to event
          </button>
        </article>
      )}

      {!loading && event && !error && !showPayment && (
        <article className="user-detail__panel">
          <div className="user-detail__topline">
            <span className={`user-phase user-phase--${event.phase.toLowerCase()}`}>
              {event.phase}
            </span>
            <span className="event-card__type">{event.type || "Event"}</span>
          </div>
          <h2 className="user-detail__title">{event.name}</h2>

          <div className="event-tabs user-tabs" role="tablist" aria-label="Event sections">
            {tabs.map((item) => (
              <button
                key={item.id}
                id={`tab-${item.id}`}
                className={`event-tabs__tab${item.id === activeTab ? " event-tabs__tab--active" : ""}`}
                type="button"
                role="tab"
                aria-selected={item.id === activeTab}
                aria-controls="event-tabpanel"
                onClick={() => onTabChange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div
            id="event-tabpanel"
            className="user-tabpanel"
            role="tabpanel"
            aria-labelledby={`tab-${activeTab}`}
          >
            {activeTab === "overview" && <OverviewTab event={event} />}
            {activeTab === "schedule" &&
              (detailLoaded ? (
                <ScheduleTab sessions={event.sessions} />
              ) : (
                <p className="event-list-message">Loading…</p>
              ))}
            {activeTab === "hospitality" && (
              <HospitalityTab key="hospitality" cache={cache} onAuthError={onAuthError} />
            )}
            {activeTab === "photographs" && (
              <PhotographsTab key="photographs" cache={cache} onAuthError={onAuthError} />
            )}
            {activeTab === "accommodation" && (
              <AccommodationTab
                key="accommodation"
                cache={cache}
                event={event}
                onAuthError={onAuthError}
                onGoToRegistration={() => onTabChange("registration")}
              />
            )}
            {activeTab === "registration" && !detailLoaded && (
              <p className="event-list-message">Loading…</p>
            )}
            {activeTab === "registration" && detailLoaded && (
              <section aria-labelledby="registration-heading">
                <h3 id="registration-heading" className="sr-only">Registration and payment</h3>
                {registerNotice && (
                  <p className="user-notice user-notice--success" role="status">
                    {registerNotice}
                  </p>
                )}
                {registerError && (
                  <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
                    {registerError}
                  </p>
                )}
                <RegistrationTab
                  event={event}
                  registering={registering}
                  onRegister={handleRegister}
                  onOpenPayment={onOpenPayment}
                />
              </section>
            )}
            {activeTab === "evaluation" && (
              <EvaluationScoresTab
                key="evaluation"
                cache={cache}
                onAuthError={onAuthError}
              />
            )}
            {activeTab === "results" && (
              <ResultsTab key="results" cache={cache} onAuthError={onAuthError} />
            )}
          </div>
        </article>
      )}
    </div>
  );
}
