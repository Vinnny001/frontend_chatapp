import { Users } from 'lucide-react';
import { mediaUrl } from '../../lib/config.js';
import { initials } from '../../lib/format.js';

const PALETTE = ['#0b8f6a', '#2563eb', '#9333ea', '#db2777', '#ea580c', '#0891b2', '#65a30d', '#c026d3', '#dc2626', '#4f46e5'];

function colorFor(seed = '') {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default function Avatar({ name, url, size = 44, online = false, group = false, onClick }) {
  const style = { width: size, height: size, fontSize: size * 0.38 };
  return (
    <div className={`avatar ${onClick ? 'clickable' : ''}`} style={style} onClick={onClick}>
      {url ? (
        <img src={mediaUrl(url)} alt="" loading="lazy" draggable="false" />
      ) : (
        <span className="avatar-fallback" style={{ background: colorFor(name) }}>
          {group ? <Users size={size * 0.45} /> : initials(name)}
        </span>
      )}
      {online && <span className="avatar-online" />}
    </div>
  );
}
