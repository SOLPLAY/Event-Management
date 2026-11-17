import { useEffect, useState } from "react";
import { formatEventDate, requestEventApi } from "./eventApi";

const EMPTY_ACCOUNT = {
  payee_name: "",
  upi_id: "",
  bank_name: "",
  account_number: "",
  ifsc_code: "",
  instructions: "",
};

function accountForm(account) {
  if (!account) return { ...EMPTY_ACCOUNT };
  return {
    payee_name: account.payee_name ?? "",
    upi_id: account.upi_id ?? "",
    bank_name: account.bank_name ?? "",
    account_number: account.account_number ?? "",
    ifsc_code: account.ifsc_code ?? "",
    instructions: account.instructions ?? "",
  };
}

function formatAmount(value) {
  const amount = Number(value ?? 0);
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function EventPayments({ event }) {
  const apiPath = `/organizer/events/${event.event_id}`;
  const paidEvent = Number(event.fee ?? 0) > 0;
  const [activeSubtab, setActiveSubtab] = useState("account");
  const [account, setAccount] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_ACCOUNT });
  const [payments, setPayments] = useState([]);
  const [remarks, setRemarks] = useState({});
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [savingAccount, setSavingAccount] = useState(false);
  const [busyPaymentId, setBusyPaymentId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    if (!paidEvent) {
      return () => {
        active = false;
      };
    }

    Promise.all([
      requestEventApi(`${apiPath}/payment-account`),
      requestEventApi(`${apiPath}/payment-submissions`),
    ])
      .then(([accountResult, paymentsResult]) => {
        if (!Array.isArray(paymentsResult.data)) {
          throw new Error("The server response did not contain payment submissions.");
        }
        if (active) {
          setAccount(accountResult.data ?? null);
          setForm(accountForm(accountResult.data));
          setPayments(paymentsResult.data);
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
  }, [apiPath, paidEvent, reloadKey]);

  function updateField(field, value) {
    setForm((currentForm) => ({ ...currentForm, [field]: value }));
  }

  async function saveAccount(submitEvent) {
    submitEvent.preventDefault();
    setSavingAccount(true);
    setError("");
    setNotice("");
    try {
      const body = JSON.stringify({
        payee_name: form.payee_name.trim(),
        upi_id: form.upi_id.trim() || null,
        bank_name: form.bank_name.trim() || null,
        account_number: form.account_number.trim() || null,
        ifsc_code: form.ifsc_code.trim() || null,
        instructions: form.instructions.trim() || null,
      });
      const result = await requestEventApi(`${apiPath}/payment-account`, {
        method: account ? "PUT" : "POST",
        body,
      });
      setAccount(result.data);
      setForm(accountForm(result.data));
      setNotice(account ? "Payment account details updated." : "Payment account details added.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingAccount(false);
    }
  }

  async function deleteAccount() {
    if (!account || !window.confirm("Remove the payment account details for this event?")) {
      return;
    }
    setSavingAccount(true);
    setError("");
    setNotice("");
    try {
      await requestEventApi(`${apiPath}/payment-account`, { method: "DELETE" });
      setAccount(null);
      setForm({ ...EMPTY_ACCOUNT });
      setNotice("Payment account details removed.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingAccount(false);
    }
  }

  async function reviewPayment(payment, decision) {
    if (
      decision === "verify" &&
      !window.confirm(
        `Verify ${formatAmount(payment.amount)} from ${payment.person_name} and confirm their registration?`
      )
    ) {
      return;
    }
    setBusyPaymentId(payment.payment_id);
    setError("");
    setNotice("");
    try {
      await requestEventApi(
        `${apiPath}/payment-submissions/${payment.payment_id}/${decision}`,
        {
          method: "POST",
          ...(decision === "reject"
            ? {
                body: JSON.stringify({
                  remarks: (remarks[payment.payment_id] ?? "").trim() || null,
                }),
              }
            : {}),
        }
      );
      setPayments((records) =>
        records.filter((record) => record.payment_id !== payment.payment_id)
      );
      setNotice(
        decision === "verify"
          ? "Payment verified and registration confirmed."
          : "Payment rejected."
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyPaymentId(null);
    }
  }

  if (!paidEvent) {
    return (
      <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
        <div className="event-workspace-panel__eyebrow">{event.name}</div>
        <h2 id="event-workspace-heading">Payments</h2>
        <p>Payment management is available only for events with a registration fee.</p>
      </section>
    );
  }

  return (
    <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
      <div className="event-workspace-panel__eyebrow">{event.name}</div>
      <h2 id="event-workspace-heading">Payments</h2>
      <p>Registration fee: {formatAmount(event.fee)}</p>

      {error && (
        <p className="hospitality-message hospitality-message--error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="hospitality-message" role="status">{notice}</p>}

      <div className="event-tabs" role="tablist" aria-label="Payment management sections">
        <button
          id="payment-account-tab"
          className={`event-tabs__tab${activeSubtab === "account" ? " event-tabs__tab--active" : ""}`}
          type="button"
          role="tab"
          aria-selected={activeSubtab === "account"}
          aria-controls="payment-account-panel"
          onClick={() => setActiveSubtab("account")}
        >
          Account details
        </button>
        <button
          id="payment-review-tab"
          className={`event-tabs__tab${activeSubtab === "review" ? " event-tabs__tab--active" : ""}`}
          type="button"
          role="tab"
          aria-selected={activeSubtab === "review"}
          aria-controls="payment-review-panel"
          onClick={() => setActiveSubtab("review")}
        >
          Verify payments
        </button>
      </div>

      {loading ? (
        <p className="hospitality-message" role="status">Loading payment details…</p>
      ) : activeSubtab === "account" ? (
        <div id="payment-account-panel" role="tabpanel" aria-labelledby="payment-account-tab">
          <form className="event-sessions-form" onSubmit={saveAccount}>
            <h3>{account ? "Update payment account" : "Add payment account"}</h3>
            <p>Provide a UPI ID or bank account number so students know where to pay.</p>
            <div className="event-form-grid">
              <label className="nitt-admin__field">
                <span>Payee name</span>
                <input
                  maxLength={250}
                  value={form.payee_name}
                  onChange={(inputEvent) => updateField("payee_name", inputEvent.target.value)}
                  required
                  disabled={savingAccount}
                />
              </label>
              <label className="nitt-admin__field">
                <span>UPI ID</span>
                <input
                  maxLength={250}
                  value={form.upi_id}
                  onChange={(inputEvent) => updateField("upi_id", inputEvent.target.value)}
                  disabled={savingAccount}
                />
              </label>
              <label className="nitt-admin__field">
                <span>Bank name</span>
                <input
                  maxLength={250}
                  value={form.bank_name}
                  onChange={(inputEvent) => updateField("bank_name", inputEvent.target.value)}
                  disabled={savingAccount}
                />
              </label>
              <label className="nitt-admin__field">
                <span>Account number</span>
                <input
                  type="text"
                  maxLength={100}
                  value={form.account_number}
                  onChange={(inputEvent) =>
                    updateField("account_number", inputEvent.target.value)
                  }
                  disabled={savingAccount}
                />
              </label>
              <label className="nitt-admin__field">
                <span>IFSC code</span>
                <input
                  maxLength={50}
                  value={form.ifsc_code}
                  onChange={(inputEvent) => updateField("ifsc_code", inputEvent.target.value)}
                  disabled={savingAccount}
                />
              </label>
              <label className="nitt-admin__field event-form-grid__description">
                <span>Payment instructions (optional)</span>
                <textarea
                  maxLength={2000}
                  rows={3}
                  value={form.instructions}
                  onChange={(inputEvent) =>
                    updateField("instructions", inputEvent.target.value)
                  }
                  disabled={savingAccount}
                />
              </label>
            </div>
            <div className="event-sessions-form__actions">
              {account && (
                <button
                  className="nitt-admin__button nitt-admin__button--danger"
                  type="button"
                  disabled={savingAccount}
                  onClick={deleteAccount}
                >
                  Remove account
                </button>
              )}
              <button
                className="nitt-admin__button nitt-admin__button--primary"
                type="submit"
                disabled={savingAccount}
              >
                {savingAccount ? "Saving…" : account ? "Save changes" : "Add account"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div id="payment-review-panel" role="tabpanel" aria-labelledby="payment-review-tab">
          <div className="event-workspace-panel__title-row">
            <h3>Submitted payments</h3>
            <button
              className="nitt-admin__button nitt-admin__button--quiet"
              type="button"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                setReloadKey((key) => key + 1);
              }}
            >
              Refresh submissions
            </button>
          </div>
          {payments.length ? (
            <div className="registration-table-wrap">
              <table className="registration-table">
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Payment date</th>
                    <th scope="col">Method / transaction</th>
                    <th scope="col">Proof</th>
                    <th scope="col">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.payment_id}>
                      <td>
                        {payment.person_name}
                        <br />
                        <small>Submitted {formatEventDate(payment.created_date)}</small>
                      </td>
                      <td>{formatAmount(payment.amount)}</td>
                      <td>{formatEventDate(payment.payment_date)}</td>
                      <td>
                        {payment.payment_method}
                        <br />
                        <small>{payment.transaction_id}</small>
                      </td>
                      <td>
                        {payment.screenshot_url ? (
                          <a href={payment.screenshot_url} target="_blank" rel="noreferrer">
                            View proof
                          </a>
                        ) : (
                          "Unavailable"
                        )}
                      </td>
                      <td>
                        <label className="nitt-admin__field">
                          <span>Rejection remark (optional)</span>
                          <textarea
                            maxLength={1000}
                            rows={2}
                            value={remarks[payment.payment_id] ?? ""}
                            onChange={(inputEvent) =>
                              setRemarks((current) => ({
                                ...current,
                                [payment.payment_id]: inputEvent.target.value,
                              }))
                            }
                            disabled={busyPaymentId !== null}
                          />
                        </label>
                        <div className="event-sessions-form__actions">
                          <button
                            className="nitt-admin__button nitt-admin__button--primary"
                            type="button"
                            disabled={busyPaymentId !== null}
                            onClick={() => reviewPayment(payment, "verify")}
                          >
                            {busyPaymentId === payment.payment_id ? "Saving…" : "Verify"}
                          </button>
                          <button
                            className="nitt-admin__button nitt-admin__button--danger"
                            type="button"
                            disabled={busyPaymentId !== null}
                            onClick={() => reviewPayment(payment, "reject")}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="hospitality-message">There are no submitted payments to review.</p>
          )}
        </div>
      )}
    </section>
  );
}
