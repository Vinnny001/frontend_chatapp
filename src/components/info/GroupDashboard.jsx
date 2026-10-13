import { useEffect, useMemo, useRef, useState } from 'react';
import { EyeOff, Lock, UserCheck } from 'lucide-react';
import Avatar from '../common/Avatar.jsx';
import { api } from '../../lib/api.js';
import { formatLastSeen, formatListTime } from '../../lib/format.js';
import { useAuth } from '../../store/auth.js';
import { displayName, handleOf } from '../../store/people.js';
import { JoinRequests } from './GroupSettings.jsx';

const RANGES = [7, 30, 90];
const nf = new Intl.NumberFormat();
const dayLabel = (iso, opts = { day: 'numeric', month: 'short' }) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, opts);
const hourLabel = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

/**
 * A single-series bar chart (one colour; the title names it, so no legend). Hover or tap a bar
 * for its value; a few axis labels only. `bars`: [{ key, label, value }]; `axis`: [{ at, label }]
 * (at = bar index).
 */
function BarChart({ bars, title, axis, unit = 'messages' }) {
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  const W = 320;
  const H = 120;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const gap = bars.length > 40 ? 1 : 2;
  const bw = (W - gap * (bars.length - 1)) / bars.length;
  const r = Math.min(4, bw / 2);
  const shown = hover != null ? bars[hover] : null;

  // Which bar is under the pointer (the whole column counts, not just the bar: easy to hit).
  const pick = (clientX) => {
    const rect = box.current.getBoundingClientRect();
    const i = Math.floor(((clientX - rect.left) / rect.width) * bars.length);
    setHover(Math.max(0, Math.min(bars.length - 1, i)));
  };

  return (
    <figure className="dash-chart">
      <figcaption>{title}</figcaption>
      <div
        ref={box}
        className="dash-plot"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
        aria-hidden="true"
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {[0.5, 1].map((f) => (
            <line key={f} className="dash-grid" x1="0" x2={W} y1={H - H * f} y2={H - H * f} />
          ))}
          {bars.map((b, i) => {
            const h = b.value ? Math.max(2, (b.value / max) * (H - 4)) : 0;
            const x = i * (bw + gap);
            const y = H - h;
            // Rounded at the top only, flat on the baseline.
            const rr = Math.min(r, h);
            const d = h
              ? `M${x},${H} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + bw - rr} Q${x + bw},${y} ${x + bw},${y + rr} V${H} Z`
              : '';
            return (
              <g key={b.key} className={hover === i ? 'on' : ''}>
                {hover === i && <rect className="dash-col" x={x} y="0" width={bw} height={H} />}
                {h > 0 && <path className="dash-bar" d={d} />}
              </g>
            );
          })}
          <line className="dash-base" x1="0" x2={W} y1={H} y2={H} />
        </svg>
        {shown && (
          // Kept inside the chart near its edges.
          <div
            className="dash-tip"
            style={{
              left: `${((hover + 0.5) / bars.length) * 100}%`,
              transform: `translate(${hover / bars.length > 0.75 ? '-100%' : hover / bars.length < 0.25 ? '0' : '-50%'}, -100%)`,
            }}
          >
            <strong>{nf.format(shown.value)}</strong> {shown.value === 1 ? unit.replace(/s$/, '') : unit}
            <span>{shown.label}</span>
          </div>
        )}
        <span className="dash-max">{nf.format(max)}</span>
      </div>
      <div className="dash-axis" aria-hidden="true">
        {axis.map((a) => {
          const at = (a.at + 0.5) / bars.length;
          return (
            <span key={a.at} style={{ left: `${at * 100}%`, transform: `translateX(${at > 0.9 ? '-100%' : at < 0.1 ? '0' : '-50%'})` }}>
              {a.label}
            </span>
          );
        })}
      </div>
      {/* The same numbers as a table, for screen readers. */}
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {bars.map((b) => (
            <tr key={b.key}>
              <th scope="row">{b.label}</th>
              <td>{b.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="dash-stat">
      <span className="dash-stat-value">{value}</span>
      <span className="dash-stat-label">{label}</span>
      {sub && <span className="dash-stat-sub">{sub}</span>}
    </div>
  );
}

/**
 * Group dashboard (admins): how much the group talks, when, and who. Built from who sent each
 * message and when (the server can't read encrypted messages). People's details follow their
 * privacy settings, and members can keep their own activity out of it.
 */
export default function GroupDashboard({ conv }) {
  const me = useAuth((s) => s.user?.id);
  const iHideLastSeen = useAuth((s) => s.user?.settings?.showLastSeen === false);
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [sort, setSort] = useState('messages'); // messages | recent | name

  useEffect(() => {
    let live = true;
    setError('');
    api(`/api/conversations/${conv.id}/insights?days=${days}&tz=${new Date().getTimezoneOffset()}`).then(
      (d) => live && setData(d),
      (e) => live && setError(e.message)
    );
    return () => {
      live = false;
    };
  }, [conv.id, days, conv.participants.length, conv.pendingJoins]);

  // Names as this viewer knows them (their contacts, else @username / number).
  const nameOf = useMemo(() => {
    const known = new Map(conv.participants.map((p) => [p.id, p.name]));
    return (m) => (m.id === me ? 'You' : known.get(m.id) || displayName(m));
  }, [conv.participants, me]);

  const members = useMemo(() => {
    if (!data) return [];
    const list = [...data.members];
    const by = {
      messages: (a, b) => (b.messages ?? -1) - (a.messages ?? -1) || nameOf(a).localeCompare(nameOf(b)),
      recent: (a, b) => Date.parse(b.lastMessageAt || 0) - Date.parse(a.lastMessageAt || 0),
      name: (a, b) => nameOf(a).localeCompare(nameOf(b)),
    }[sort];
    return list.sort(by);
  }, [data, sort, nameOf]);

  if (conv.me?.role !== 'admin') return <p className="panel-empty">Only group admins can see the dashboard.</p>;
  if (error) return <p className="panel-empty">{error}</p>;
  if (!data) return <p className="panel-empty">Loading…</p>;

  const t = data.totals;
  const daily = data.daily.map((d) => ({ key: d.date, label: dayLabel(d.date, { weekday: 'short', day: 'numeric', month: 'short' }), value: d.count }));
  const n = data.daily.length;
  const dayAxis = [0, Math.floor((n - 1) / 2), n - 1].map((i) => ({ at: i, label: dayLabel(data.daily[i].date) }));
  const hours = data.hours.map((n, h) => ({ key: h, label: `${hourLabel(h)}–${hourLabel((h + 1) % 24)}`, value: n }));
  const busiest = data.hours.indexOf(Math.max(...data.hours));
  const topDay = data.daily.reduce((a, b) => (b.count > a.count ? b : a), data.daily[0]);
  const maxMember = Math.max(1, ...data.members.map((m) => m.messages || 0));
  const quiet = data.members.filter((m) => m.messages === 0).length;

  return (
    <div className="dashboard">
      <div className="segmented dash-range" role="radiogroup" aria-label="Period">
        {RANGES.map((d) => (
          <button key={d} role="radio" aria-checked={days === d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>
            {d} days
          </button>
        ))}
      </div>

      <div className="dash-stats">
        <Stat label={`Messages, last ${days} days`} value={nf.format(t.messagesInRange)} sub={`${nf.format(t.messages)} since the group started`} />
        <Stat label="Active members" value={`${t.activeMembers} of ${t.members}`} sub="sent at least one message" />
        <Stat label="New members" value={nf.format(t.newMembers)} sub={`joined in the last ${days} days`} />
        <Stat label="Admins" value={nf.format(t.admins)} sub={quiet ? `${quiet} member${quiet === 1 ? '' : 's'} didn’t post` : 'everyone posted'} />
      </div>

      {t.pendingJoins > 0 && (
        <button className="dash-pending" onClick={() => setReviewing(true)}>
          <UserCheck size={18} /> {t.pendingJoins} {t.pendingJoins === 1 ? 'person is' : 'people are'} waiting to join. Review
        </button>
      )}

      <section className="info-card">
        <BarChart title="Messages per day" bars={daily} axis={dayAxis} />
        {topDay?.count > 0 && (
          <p className="dash-note">
            Busiest day: <strong>{dayLabel(topDay.date, { weekday: 'long', day: 'numeric', month: 'short' })}</strong> ({nf.format(topDay.count)})
          </p>
        )}
      </section>

      <section className="info-card">
        <BarChart title="When the group is busiest" bars={hours} axis={[0, 6, 12, 18, 23].map((h) => ({ at: h, label: hourLabel(h) }))} />
        {t.messagesInRange > 0 && (
          <p className="dash-note">
            Most messages arrive between <strong>{hourLabel(busiest)}</strong> and <strong>{hourLabel((busiest + 1) % 24)}</strong> (your time).
          </p>
        )}
      </section>

      <section className="info-card dash-members">
        <div className="dash-members-head">
          <h3 className="section-label">Members</h3>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort members">
            <option value="messages">Most messages</option>
            <option value="recent">Posted recently</option>
            <option value="name">Name</option>
          </select>
        </div>
        {members.map((m) => {
          const contact = [handleOf(m) !== nameOf(m) && handleOf(m), m.phone, m.email].filter(Boolean);
          return (
            <div key={m.id} className="dash-member">
              <Avatar name={nameOf(m)} url={m.avatarUrl} size={40} />
              <div className="dash-member-main">
                <div className="dash-member-top">
                  <span className="person-name">{nameOf(m)}</span>
                  {m.role === 'admin' && <span className="admin-badge">Admin</span>}
                  <span className="dash-count">{m.activityHidden ? <EyeOff size={15} aria-label="Activity private" /> : nf.format(m.messages)}</span>
                </div>
                {!m.activityHidden && (
                  <span className="dash-meter" aria-hidden="true">
                    <span style={{ width: `${(m.messages / maxMember) * 100}%` }} />
                  </span>
                )}
                <span className="person-sub">
                  {m.activityHidden
                    ? 'Keeps their activity private'
                    : m.lastMessageAt
                      ? `Last posted ${formatListTime(m.lastMessageAt)} · ${nf.format(m.total)} in all`
                      : 'Hasn’t posted yet'}
                  {' · '}joined {formatListTime(m.joinedAt)}
                  {!iHideLastSeen && m.lastSeen && m.id !== me ? ` · ${formatLastSeen(m.lastSeen)}` : ''}
                </span>
                {contact.length > 0 && <span className="person-sub dash-contact">{contact.join(' · ')}</span>}
              </div>
            </div>
          );
        })}
      </section>

      <p className="dash-privacy">
        <Lock size={14} /> Built from who sent each message and when. ChatApp can’t read what encrypted messages say. Phone numbers, emails and
        last seen show only for members who allow it, and members who turn off “Share my activity in group insights” are counted in the totals only.
      </p>

      {reviewing && <JoinRequests conv={conv} onClose={() => setReviewing(false)} />}
    </div>
  );
}
