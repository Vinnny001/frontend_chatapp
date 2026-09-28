import { useEffect, useRef, useState } from 'react';
import { EMOJI_GROUPS } from '../../lib/emoji.js';
import { storage } from '../../lib/storage.js';

export default function EmojiPicker({ onPick, onClose }) {
  const [recent, setRecent] = useState(() => storage.get('emoji.recent', []));
  const [tab, setTab] = useState(recent.length ? 'recent' : EMOJI_GROUPS[0].name);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => !ref.current?.contains(e.target) && !e.target.closest?.('[data-emoji-toggle]') && onClose?.();
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [onClose]);

  function pick(emoji) {
    const next = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, 32);
    setRecent(next);
    storage.set('emoji.recent', next);
    onPick(emoji);
  }

  const list = tab === 'recent' ? recent : EMOJI_GROUPS.find((g) => g.name === tab)?.list || [];

  return (
    <div className="emoji-picker" ref={ref}>
      <div className="emoji-tabs">
        {recent.length > 0 && (
          <button className={tab === 'recent' ? 'active' : ''} onClick={() => setTab('recent')} title="Recent">
            🕘
          </button>
        )}
        {EMOJI_GROUPS.map((g) => (
          <button key={g.name} className={tab === g.name ? 'active' : ''} onClick={() => setTab(g.name)} title={g.name}>
            {g.icon}
          </button>
        ))}
      </div>
      <div className="emoji-grid">
        {list.map((e) => (
          <button key={e} onClick={() => pick(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
