import { useCallback, useEffect, useState } from "react";
import { formatEventDate, requestEventApi } from "./eventApi";

const CHART_COLORS = ["#9d3b32", "#315e83", "#d18b2c", "#438064", "#8064a2", "#6b7780"];

function formatAmount(value) {
  const amount = Number(value ?? 0);
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function safeExternalUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function MetricCard({ label, value, detail }) {
  return (
    <article className="event-report-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}

function DonutChart({ title, data, centerValue }) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  let accumulated = 0;
  const gradient = total
    ? data
        .filter((item) => item.count > 0)
        .map((item) => {
          const start = accumulated;
          accumulated += (item.count / total) * 100;
          return `${item.color} ${start}% ${accumulated}%`;
        })
        .join(", ")
    : "#e4e6e3 0% 100%";

  return (
    <section className="event-report-chart" aria-label={title}>
      <h3>{title}</h3>
      <div className="event-report-donut-layout">
        <div
          className="event-report-donut"
          role="img"
          aria-label={`${title}: ${data.map((item) => `${item.label} ${item.count}`).join(", ")}`}
          style={{ background: `conic-gradient(${gradient})` }}
        >
          <div className="event-report-donut__center">
            <strong>{centerValue ?? total}</strong>
            <span>Total</span>
          </div>
        </div>
        <ul className="event-report-legend">
          {data.map((item, index) => (
            <li key={`${item.label}-${index}`}>
              <span style={{ backgroundColor: item.color }} aria-hidden="true" />
              {item.label}
              <strong>{item.count}</strong>
            </li>
          ))}
        </ul>
      </div>
      {!total && <p className="event-report-chart__empty">No records yet</p>}
    </section>
  );
}

function BarChart({ title, data, valueFormatter = (value) => value }) {
  const chartData = data.filter((item) => Number.isFinite(item.count));
  const maxValue = Math.max(...chartData.map((item) => item.count), 0);
  const width = 620;
  const height = 250;
  const left = 42;
  const right = 12;
  const top = 14;
  const bottom = 54;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const slot = chartData.length ? plotWidth / chartData.length : plotWidth;
  const barWidth = Math.min(54, slot * 0.62);
  const tickValues = maxValue > 0 ? [0, maxValue / 2, maxValue] : [0, 0.5, 1];

  return (
    <section className="event-report-chart" aria-label={title}>
      <h3>{title}</h3>
      {chartData.length ? (
        <div className="event-report-bar-wrap">
          <svg
            className="event-report-bar-chart"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${title}: ${chartData.map((item) => `${item.label} ${item.count}`).join(", ")}`}
          >
            {tickValues.map((value, index) => {
              const y = top + plotHeight - (maxValue ? value / maxValue : 0) * plotHeight;
              return (
                <g key={`${value}-${index}`}>
                  <line
                    x1={left}
                    y1={y}
                    x2={width - right}
                    y2={y}
                    className="event-report-bar-chart__gridline"
                  />
                  <text x={left - 8} y={y + 4} textAnchor="end">
                    {valueFormatter(value)}
                  </text>
                </g>
              );
            })}
            <line
              x1={left}
              y1={top + plotHeight}
              x2={width - right}
              y2={top + plotHeight}
              className="event-report-bar-chart__axis"
            />
            {chartData.map((item, index) => {
              const x = left + slot * index + (slot - barWidth) / 2;
              const barHeight = maxValue ? (item.count / maxValue) * plotHeight : 0;
              const label = item.label.length > 13 ? `${item.label.slice(0, 11)}…` : item.label;
              return (
                <g key={`${item.label}-${index}`}>
                  <rect
                    x={x}
                    y={top + plotHeight - barHeight}
                    width={barWidth}
                    height={Math.max(barHeight, 0)}
                    rx="3"
                    fill={CHART_COLORS[index % CHART_COLORS.length]}
                  />
                  <text
                    x={x + barWidth / 2}
                    y={top + plotHeight - barHeight - 7}
                    textAnchor="middle"
                    className="event-report-bar-chart__value"
                  >
                    {item.count}
                  </text>
                  <text
                    x={x + barWidth / 2}
                    y={top + plotHeight + 20}
                    textAnchor="middle"
                    className="event-report-bar-chart__label"
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <p className="event-report-chart__empty">No records yet</p>
      )}
    </section>
  );
}

function toChartData(data) {
  return data.map((item, index) => ({
    label: String(item.label),
    count: Number(item.count) || 0,
    color: CHART_COLORS[index % CHART_COLORS.length],
  }));
}

async function fetchEventReport(eventId) {
  const result = await requestEventApi(`/organizer/events/${eventId}/report`);
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
    throw new Error("The server response did not contain valid event statistics.");
  }
  return result.data;
}

export default function EventReport({ event }) {
  const eventId = event.event_id;
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setReport(await fetchEventReport(eventId));
    } catch (requestError) {
      setReport(null);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    let active = true;
    fetchEventReport(eventId)
      .then((result) => {
        if (active) {
          setReport(result);
          setError("");
        }
      })
      .catch((requestError) => {
        if (active) {
          setReport(null);
          setError(requestError.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [eventId]);

  if (loading) {
    return (
      <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
        <div className="event-workspace-panel__eyebrow">{event.name}</div>
        <h2 id="event-workspace-heading">Event report</h2>
        <p className="hospitality-message" role="status">Loading event statistics…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
        <div className="event-workspace-panel__eyebrow">{event.name}</div>
        <div className="event-workspace-panel__title-row">
          <div>
            <h2 id="event-workspace-heading">Event report</h2>
            <p>Attendance, registration, sponsor, speaker, and evaluation statistics.</p>
          </div>
          <button
            className="nitt-admin__button nitt-admin__button--quiet"
            type="button"
            onClick={loadReport}
          >
            Retry
          </button>
        </div>
        <p className="hospitality-message hospitality-message--error" role="alert">{error}</p>
      </section>
    );
  }

  const registrations = report.registrations ?? {};
  const attendance = report.attendance ?? {};
  const sessions = report.sessions ?? {};
  const sponsors = report.sponsors ?? {};
  const evaluations = report.evaluations ?? {};
  const registrationStatus = toChartData(registrations.status_counts ?? []);
  const attendanceStatus = toChartData([
    { label: "Present marks", count: attendance.present_session_marks ?? 0 },
    { label: "Absent marks", count: attendance.absent_session_marks ?? 0 },
    { label: "Unmarked", count: attendance.unmarked_session_slots ?? 0 },
  ]);
  const sponsorLevels = toChartData(sponsors.by_level ?? []);
  const photographsUrl = safeExternalUrl(report.photographs_url);
  const startDate = report.event?.start_date;
  const endDate = report.event?.end_date;

  return (
    <section className="event-workspace-panel" aria-labelledby="event-workspace-heading">
      <div className="event-workspace-panel__eyebrow">{event.name}</div>
      <div className="event-workspace-panel__title-row">
        <div>
          <h2 id="event-workspace-heading">Event report</h2>
          <p>Attendance, registration, sponsor, speaker, and evaluation statistics.</p>
        </div>
        <button
          className="nitt-admin__button nitt-admin__button--quiet"
          type="button"
          onClick={loadReport}
        >
          Refresh report
        </button>
      </div>

      <div className="event-report-event-meta">
        <span>{formatEventDate(startDate)} - {formatEventDate(endDate)}</span>
        <span>Registration fee: {formatAmount(report.event?.registration_fee)}</span>
        {report.report_date && <span>Report date: {formatEventDate(report.report_date)}</span>}
      </div>

      <div className="event-report-metrics">
        <MetricCard label="Registered students" value={registrations.total ?? 0} />
        <MetricCard
          label="Students present"
          value={attendance.present_students ?? 0}
          detail={`${attendance.present_session_marks ?? 0} present session marks`}
        />
        <MetricCard
          label="Verified fees collected"
          value={formatAmount(registrations.fees_collected)}
          detail={`${registrations.verified_payments_count ?? 0} verified payments`}
        />
        <MetricCard
          label="Registration fee paid total"
          value={formatAmount(registrations.fee_paid_total)}
        />
        <MetricCard label="Sponsors" value={sponsors.total ?? 0} />
        <MetricCard
          label="Speakers"
          value={sessions.speakers_count ?? 0}
          detail={`${sessions.total ?? 0} sessions`}
        />
        <MetricCard
          label="Evaluations"
          value={evaluations.total ?? 0}
          detail={`${evaluations.certificates_issued ?? 0} certificates issued`}
        />
        <MetricCard
          label="Average score"
          value={evaluations.average_score ?? "—"}
          detail={`${evaluations.scored_count ?? 0} scores`}
        />
        <MetricCard label="Highest score" value={evaluations.highest_score ?? "—"} />
        <MetricCard label="Hospitality plans" value={report.hospitality_plans ?? 0} />
      </div>

      <div className="event-report-charts">
        <DonutChart
          title="Registration status"
          data={registrationStatus}
          centerValue={registrations.total ?? 0}
        />
        <DonutChart
          title="Session attendance"
          data={attendanceStatus}
          centerValue={attendance.total_session_slots ?? 0}
        />
        <BarChart title="Evaluation score distribution" data={evaluations.score_distribution ?? []} />
        <BarChart title="Sponsors by level" data={sponsorLevels} />
      </div>

      {sessions.speaker_names?.length > 0 && (
        <section className="event-report-speakers">
          <h3>Speakers</h3>
          <ul>
            {sessions.speaker_names.map((speaker) => <li key={speaker}>{speaker}</li>)}
          </ul>
        </section>
      )}

      {(report.summary_text || report.total_attendees !== undefined || report.photographs_url) && (
        <section className="event-report-summary">
          <h3>Organizer notes</h3>
          {report.total_attendees !== null && report.total_attendees !== undefined && (
            <p><strong>Reported attendees:</strong> {report.total_attendees}</p>
          )}
          {report.summary_text && <p>{report.summary_text}</p>}
          {photographsUrl ? (
            <a href={photographsUrl} target="_blank" rel="noopener noreferrer">
              View event photographs
            </a>
          ) : report.photographs_url ? (
            <p>The photograph URL is invalid.</p>
          ) : null}
        </section>
      )}
    </section>
  );
}
