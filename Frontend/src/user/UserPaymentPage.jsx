import { useEffect, useState } from "react";
import { formatEventDate } from "../eventApi";
import {
  formatAmount,
  formatFee,
  readFileAsDataUrl,
  requestUserApi,
  todayLocalIso,
} from "./userApi";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

const statusText = {
  Submitted: "Awaiting verification",
  Verified: "Verified",
  Rejected: "Rejected",
};

function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available: the value is still on screen to copy by hand */
    }
  }

  return (
    <button
      className="user-copy"
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function PayToCard({ account, fee }) {
  const rows = [
    ["Pay to", account.payee_name],
    ["UPI ID", account.upi_id],
    ["Bank", account.bank_name],
    ["Account number", account.account_number],
    ["IFSC code", account.ifsc_code],
  ].filter(([, value]) => value);

  return (
    <section className="user-paycard" aria-labelledby="payto-heading">
      <h3 id="payto-heading">Step 1 · Make the payment</h3>
      <p className="user-paycard__amount">
        Amount to pay <strong>{formatFee(fee)}</strong>
      </p>
      <dl className="user-paycard__rows">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <span>{value}</span>
              {["UPI ID", "Account number", "IFSC code"].includes(label) && (
                <CopyButton value={value} label={label} />
              )}
            </dd>
          </div>
        ))}
      </dl>
      {account.instructions && <p className="user-paycard__note">{account.instructions}</p>}
      <p className="user-detail__muted">
        Pay using any UPI app or net banking, then note the transaction ID (UTR) and take a
        screenshot of the confirmation.
      </p>
    </section>
  );
}

function SubmissionList({ submissions }) {
  if (!submissions.length) return null;
  return (
    <section className="user-detail__section" aria-labelledby="history-heading">
      <h3 id="history-heading">Your payment submissions</h3>
      <ul className="user-list">
        {submissions.map((item) => (
          <li key={item.payment_id} className="user-list__row user-list__row--stack">
            <div className="user-list__line">
              <span className="user-list__main">
                {formatAmount(item.amount)} · {item.payment_method} · {item.transaction_id}
              </span>
              <span className={`user-pay user-pay--${item.status.toLowerCase()}`}>
                {statusText[item.status] ?? item.status}
              </span>
            </div>
            <div className="user-list__side">
              Paid on {formatEventDate(item.payment_date)}
              {item.screenshot_url && (
                <>
                  {" · "}
                  <a href={item.screenshot_url} target="_blank" rel="noopener noreferrer">
                    View screenshot
                  </a>
                </>
              )}
            </div>
            {item.status === "Rejected" && item.remarks && (
              <div className="user-pay__reason">Reason: {item.remarks}</div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// The payment page of a paid event. Mount with a key per event.
export default function UserPaymentPage({ eventId, onBack, onAuthError, onChanged }) {
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [transactionId, setTransactionId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayLocalIso());
  const [method, setMethod] = useState("UPI");
  const [screenshot, setScreenshot] = useState(null); // { name, dataUrl }
  const [fileError, setFileError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;

    async function loadPage() {
      try {
        const result = await requestUserApi(`/events/${eventId}/payment`);
        if (!result.data || typeof result.data !== "object") {
          throw new Error("The server response was not in the expected format.");
        }
        if (!active) return;
        setPage(result.data);
        setLoadError("");
        // Pre-fill the amount with the fee, unless the user already typed something.
        setAmount((current) => (current === "" ? String(result.data.fee ?? "") : current));
      } catch (requestError) {
        if (!active) return;
        if (requestError.status === 401) {
          onAuthError();
          return;
        }
        setLoadError(requestError.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadPage();
    return () => {
      active = false;
    };
  }, [eventId, reloadKey, onAuthError]);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    setFileError("");
    setScreenshot(null);
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setFileError("Please choose a PNG, JPG or WebP image.");
      event.target.value = "";
      return;
    }
    const maxMb = page?.max_image_mb ?? 5;
    if (file.size > maxMb * 1024 * 1024) {
      setFileError(`The image is too large. The limit is ${maxMb} MB.`);
      event.target.value = "";
      return;
    }
    try {
      setScreenshot({ name: file.name, dataUrl: await readFileAsDataUrl(file) });
    } catch (readError) {
      setFileError(readError.message);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setFormError("");
    setNotice("");
    if (!screenshot) {
      setFormError("Attach a screenshot of your payment.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await requestUserApi(`/events/${eventId}/payment`, {
        method: "POST",
        body: JSON.stringify({
          transaction_id: transactionId.trim(),
          amount: amount.trim(),
          payment_date: paymentDate,
          payment_method: method,
          screenshot: screenshot.dataUrl,
        }),
      });
      setNotice(result.data?.message || "Payment details submitted.");
      setTransactionId("");
      setScreenshot(null);
      setFileError("");
      setReloadKey((key) => key + 1);
      onChanged();
    } catch (requestError) {
      if (requestError.status === 401) {
        onAuthError();
        return;
      }
      setFormError(requestError.message);
      if (requestError.status === 409) {
        setReloadKey((key) => key + 1); // the state changed under us (e.g. another tab): show the truth
        onChanged();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="user-detail__panel user-payment">
      <button
        className="nitt-admin__button nitt-admin__button--quiet user-detail__back"
        type="button"
        onClick={onBack}
      >
        ← Back to event
      </button>

      {loading && <p className="event-list-message">Loading payment page…</p>}

      {!loading && loadError && (
        <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
          {loadError}
          <button
            className="nitt-admin__action"
            type="button"
            onClick={() => {
              setLoading(true);
              setReloadKey((key) => key + 1);
            }}
          >
            Retry
          </button>
        </p>
      )}

      {!loading && page && (
        <>
          <div>
            <div className="nitt-admin__eyebrow">Payment</div>
            <h2 className="user-detail__title">{page.event_name}</h2>
            <p className="user-detail__muted">
              Registration status: <strong>{page.registration.status}</strong>
              {page.registration.status === "Pending" &&
                " — your place is confirmed once the organiser verifies your payment."}
            </p>
          </div>

          {notice && (
            <p className="user-notice user-notice--success" role="status">
              {notice}
            </p>
          )}

          <div className="user-payment__grid">
            {page.account && Number(page.fee) > 0 ? (
              <PayToCard account={page.account} fee={page.fee} />
            ) : (
              <section className="user-paycard" aria-labelledby="payto-heading">
                <h3 id="payto-heading">Step 1 · Make the payment</h3>
                <p className="user-detail__muted">
                  {Number(page.fee) > 0
                    ? "The organiser has not published the payment details for this event yet."
                    : "This event is free - no payment is needed."}
                </p>
              </section>
            )}

            <section className="user-paycard" aria-labelledby="proof-heading">
              <h3 id="proof-heading">Step 2 · Upload your payment proof</h3>

              {!page.can_submit ? (
                <p className="user-detail__muted" role="status">
                  {page.blocked_reason}
                </p>
              ) : (
                <form className="user-payform" onSubmit={handleSubmit} noValidate>
                  {formError && (
                    <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
                      {formError}
                    </p>
                  )}

                  <label className="nitt-admin__field">
                    <span>Transaction ID / UTR</span>
                    <input
                      value={transactionId}
                      onChange={(event) => setTransactionId(event.target.value)}
                      maxLength={40}
                      autoComplete="off"
                      required
                    />
                  </label>

                  <div className="user-payform__pair">
                    <label className="nitt-admin__field">
                      <span>Amount paid (₹)</span>
                      <input
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        inputMode="decimal"
                        required
                      />
                    </label>
                    <label className="nitt-admin__field">
                      <span>Payment date</span>
                      <input
                        type="date"
                        value={paymentDate}
                        max={todayLocalIso()}
                        onChange={(event) => setPaymentDate(event.target.value)}
                        required
                      />
                    </label>
                  </div>

                  <label className="nitt-admin__field">
                    <span>Paid using</span>
                    <select value={method} onChange={(event) => setMethod(event.target.value)}>
                      {(page.payment_methods ?? ["UPI"]).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="nitt-admin__field">
                    <span>Screenshot (PNG, JPG or WebP, up to {page.max_image_mb} MB)</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} />
                  </label>
                  {fileError && (
                    <p className="nitt-admin__notice nitt-admin__notice--error" role="alert">
                      {fileError}
                    </p>
                  )}
                  {screenshot && (
                    <img className="user-payform__preview" src={screenshot.dataUrl} alt="Your screenshot" />
                  )}

                  <button
                    className="nitt-admin__button nitt-admin__button--primary"
                    type="submit"
                    disabled={submitting}
                  >
                    {submitting ? "Submitting…" : "Submit payment details"}
                  </button>
                </form>
              )}
            </section>
          </div>

          <SubmissionList submissions={page.submissions ?? []} />
        </>
      )}
    </div>
  );
}
