import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Download, Flag, RefreshCw, Search, Shield, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { API_URL } from '../../lib/config.js';
import { formatListTime } from '../../lib/format.js';
import { useAuth } from '../../store/auth.js';
import { toast, useUI } from '../../store/ui.js';

const REASONS = { spam: 'Spam', scam: 'Scam or fraud', harassment: 'Harassment', inappropriate: 'Inappropriate', impersonation: 'Impersonation', other: 'Other' };

/** One number with a label (stat tile). */
function Stat({ label, value, sub, tone }) {
  return (
    <div className={`admin-stat ${tone || ''}`}>
      <span className="admin-stat-label">{label}</span>
      <strong className="admin-stat-value">{value ?? '–'}</strong>
      {sub && <span className="admin-stat-sub">{sub}</span>}
    </div>
  );
}

/** Daily counts for the last 14 days: one series, thin bars, value on hover, latest labelled. */
function DailyBars({ title, series }) {
  const max = Math.max(1, ...series.map((d) => d.count));
  const total = series.reduce((n, d) => n + d.count, 0);
  const label = (d) => new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const last = series[series.length - 1];
  return (
    <figure className="admin-chart">
      <figcaption>
        <span>{title}</span>
        <span className="admin-chart-total">{total} in 14 days</span>
      </figcaption>
      <div className="admin-bars" role="img" aria-label={`${title}: ${series.map((d) => `${label(d)} ${d.count}`).join(', ')}`}>
        {series.map((d) => (
          <div key={d.day} className="admin-bar-slot" data-tip={`${label(d)}: ${d.count}`}>
            <div className="admin-bar" style={{ height: `${(d.count / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="admin-axis">
        <span>{label(series[0])}</span>
        <span>
          Today: <strong>{last.count}</strong>
        </span>
      </div>
    </figure>
  );
}

function Overview() {
  const [s, setS] = useState(null);
  const load = () => api('/api/admin/stats').then(setS, (e) => toast(e.message, 'error'));
  useEffect(() => {
    load();
  }, []);
  if (!s) return <p className="panel-empty">Loading…</p>;
  return (
    <div className="admin-overview">
      <div className="admin-stats">
        <Stat label="Users" value={s.users.total} sub={`+${s.users.newWeek} this week`} />
        <Stat label="Active today" value={s.users.activeToday} sub={`${s.users.activeWeek} this week`} />
        <Stat label="Messages today" value={s.messages.today} sub={`${s.messages.week} this week`} />
        <Stat label="Chats" value={s.chats.direct + s.chats.groups} sub={`${s.chats.groups} group${s.chats.groups === 1 ? '' : 's'}`} />
        <Stat label="Open reports" value={s.reports.open} tone={s.reports.open ? 'alert' : ''} />
        <Stat label="Email not confirmed" value={s.users.unverified} />
        <Stat label="Disabled" value={s.users.disabled} />
        <Stat
          label="Media storage"
          value={s.storage ? `${s.storage.storageMb} MB` : '–'}
          sub={s.storage?.creditsUsedPercent != null ? `${Math.round(s.storage.creditsUsedPercent)}% of free plan used` : undefined}
        />
      </div>
      <DailyBars title="New sign-ups per day" series={s.series.signups} />
      <DailyBars title="Messages per day" series={s.series.messages} />
      <DailyBars title="Calls per day" series={s.series.calls} />
      <button className="btn btn-ghost" onClick={load}>
        <RefreshCw size={16} /> Refresh
      </button>
    </div>
  );
}

async function downloadCsv() {
  try {
    const res = await fetch(`${API_URL}/api/admin/export/users.csv`, { headers: { Authorization: `Bearer ${useAuth.getState().token}` } });
    if (!res.ok) throw new Error('Export failed');
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `chatapp-users-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function Users() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState(null);
  const load = () => {
    const params = new URLSearchParams({ q: q.trim(), filter });
    api(`/api/admin/users?${params}`).then(setData, (e) => toast(e.message, 'error'));
  };
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, filter]);

  async function setDisabled(u, disabled) {
    if (disabled && !window.confirm(`Disable ${u.name}? They are signed out everywhere and can’t sign in.`)) return;
    try {
      await api(`/api/admin/users/${u.id}/disable`, { method: 'POST', body: { disabled } });
      toast(disabled ? `${u.name} disabled` : `${u.name} enabled`);
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <div className="admin-users">
      <div className="admin-toolbar">
        <div className="panel-search shared-search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, @username, email or phone" />
        </div>
        <button className="btn btn-ghost" onClick={downloadCsv}>
          <Download size={16} /> Export CSV
        </button>
      </div>
      <div className="shared-tabs">
        {[
          ['all', 'All'],
          ['unverified', 'Email not confirmed'],
          ['disabled', 'Disabled'],
        ].map(([id, label]) => (
          <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      {!data && <p className="panel-empty">Loading…</p>}
      {data && <p className="hint">{data.total} account{data.total === 1 ? '' : 's'}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Joined</th>
              <th>Last seen</th>
              <th>Messages</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => (
              <tr key={u.id} className={u.disabled ? 'is-disabled' : ''}>
                <td>
                  <strong>{u.name}</strong>
                  {u.username && <span className="admin-muted"> @{u.username}</span>}
                  {u.admin && <span className="admin-badge">admin</span>}
                  {u.disabled && <span className="admin-badge danger">disabled</span>}
                  {!u.emailVerified && <span className="admin-badge">unconfirmed</span>}
                </td>
                <td>{u.email}</td>
                <td>{u.phone}</td>
                <td>{formatListTime(u.createdAt)}</td>
                <td>{u.lastSeen ? formatListTime(u.lastSeen) : '–'}</td>
                <td>{u.messages}</td>
                <td>
                  {!u.admin && (
                    <button className={`link-btn ${u.disabled ? '' : 'danger'}`} onClick={() => setDisabled(u, !u.disabled)}>
                      {u.disabled ? 'Enable' : 'Disable'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Reports({ onCount }) {
  const [status, setStatus] = useState('open');
  const [reports, setReports] = useState(null);
  const load = () =>
    api(`/api/admin/reports?status=${status}`).then(
      (d) => {
        setReports(d.reports);
        if (status === 'open') onCount(d.reports.length);
      },
      (e) => toast(e.message, 'error')
    );
  useEffect(() => {
    setReports(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function close(r, next, disableUser = false) {
    if (disableUser && !window.confirm(`Disable ${r.reported?.name}'s account?`)) return;
    try {
      await api(`/api/admin/reports/${r.id}`, { method: 'PATCH', body: { status: next, disableUser } });
      toast(disableUser ? 'Account disabled, report closed' : 'Report closed');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  return (
    <div className="admin-reports">
      <div className="shared-tabs">
        {[
          ['open', 'Open'],
          ['actioned', 'Actioned'],
          ['dismissed', 'Dismissed'],
        ].map(([id, label]) => (
          <button key={id} className={status === id ? 'active' : ''} onClick={() => setStatus(id)}>
            {label}
          </button>
        ))}
      </div>
      {reports === null && <p className="panel-empty">Loading…</p>}
      {reports?.length === 0 && (
        <div className="panel-empty big">
          <Flag size={40} />
          <p>No {status} reports.</p>
        </div>
      )}
      {reports?.map((r) => (
        <article key={r.id} className="admin-report">
          <header>
            <div>
              <strong>{r.reported?.name || 'Deleted account'}</strong>
              {r.reported?.username && <span className="admin-muted"> @{r.reported.username}</span>}
              {r.reported?.disabled && <span className="admin-badge danger">disabled</span>}
              <div className="admin-muted">
                {r.reported?.email} · {r.reported?.phone}
              </div>
            </div>
            <span className="admin-badge alert">{REASONS[r.reason] || r.reason}</span>
          </header>
          <p className="admin-muted">
            Reported by {r.reporter?.name || 'someone'} · {formatListTime(r.createdAt)}
            {r.timesReported > 1 && <strong> · reported {r.timesReported} times</strong>}
          </p>
          {r.details && <p className="admin-details">“{r.details}”</p>}
          {r.messages.length > 0 && (
            <div className="admin-evidence">
              <span className="admin-muted">Their last messages in that chat:</span>
              {r.messages.map((m, i) => (
                <div key={i} className="admin-evidence-msg">
                  {m.text || (m.mediaUrl ? `[${m.type}]` : '')}
                  <span className="admin-muted"> · {formatListTime(m.at)}</span>
                </div>
              ))}
            </div>
          )}
          {r.status === 'open' && (
            <div className="admin-actions">
              <button className="btn btn-ghost" onClick={() => close(r, 'dismissed')}>
                Dismiss
              </button>
              <button className="btn btn-ghost" onClick={() => close(r, 'actioned')}>
                Mark handled
              </button>
              {!r.reported?.disabled && (
                <button className="btn btn-danger" onClick={() => close(r, 'actioned', true)}>
                  <Ban size={16} /> Disable account
                </button>
              )}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

/** The admin page (accounts listed in ADMIN_EMAILS on the server). */
export default function AdminPanel() {
  const open = useUI((s) => s.adminOpen);
  const [tab, setTab] = useState('overview');
  const [openReports, setOpenReports] = useState(null);
  if (!open) return null;
  const close = () => useUI.getState().setAdminOpen(false);
  return createPortal(
    <div className="admin-page" role="dialog" aria-label="Admin">
      <header className="admin-header">
        <Shield size={20} />
        <h2>Admin</h2>
        <nav className="admin-tabs">
          {[
            ['overview', 'Overview'],
            ['users', 'Users'],
            ['reports', `Reports${openReports ? ` (${openReports})` : ''}`],
          ].map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <button className="icon-btn" onClick={close} aria-label="Close admin">
          <X size={22} />
        </button>
      </header>
      <main className="admin-body">
        {tab === 'overview' && <Overview />}
        {tab === 'users' && <Users />}
        {tab === 'reports' && <Reports onCount={setOpenReports} />}
      </main>
    </div>,
    document.body
  );
}
