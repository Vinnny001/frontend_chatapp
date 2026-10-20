import Avatar from '../common/Avatar.jsx';

/**
 * An avatar inside the status ring: one segment per update, coloured while there are updates
 * not seen yet (grey once seen), as on WhatsApp.
 */
export default function StatusRing({ name, url, count, seen = 0, size = 48, onClick, children }) {
  const box = size + 8;
  const r = box / 2 - 2;
  const c = 2 * Math.PI * r;
  const n = Math.max(1, count);
  const gap = n > 1 ? Math.min(6, c / n / 4) : 0;
  const seg = c / n - gap;
  return (
    <span className="status-ring" style={{ width: box, height: box }} onClick={onClick}>
      {count > 0 && (
        <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden="true">
          {Array.from({ length: n }, (_, i) => (
            <circle
              key={i}
              cx={box / 2}
              cy={box / 2}
              r={r}
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              className={i < seen ? 'seen' : 'unseen'}
              strokeDasharray={`${seg} ${c - seg}`}
              strokeDashoffset={-i * (seg + gap) + c / 4}
            />
          ))}
        </svg>
      )}
      <Avatar name={name} url={url} size={size} />
      {children}
    </span>
  );
}
