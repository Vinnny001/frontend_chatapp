import { useRef, useState } from 'react';
import Avatar from '../common/Avatar.jsx';
import { atName, mentionToken } from '../../lib/mentions.js';

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @mentions for a text box in a group (the message box, a photo's caption): the "@Name" shown
 * in the box, the list to pick from while typing "@…", the names coloured, and the tokens sent.
 * `update(value)` sets the box's text; `input` is its ref.
 */
export function useMentions({ conv, me, text, update, input }) {
  const mentioned = useRef(new Map()); // "@Name" shown -> the token that is sent
  const [mention, setMention] = useState(null); // { start, end, q } while typing "@…"
  const [index, setIndex] = useState(0);

  const members = conv.type === 'group' ? conv.participants.filter((p) => p.id !== me) : [];
  const candidates = mention
    ? members
        .filter((p) => [p.name, p.username, p.phone].some((v) => v?.toLowerCase().includes(mention.q)))
        .slice(0, 8)
    : [];

  /**
   * The "@Name"s in the box that are mentions: picked from the list, or typed in full (a group
   * member's name or @username, as on WhatsApp).
   */
  function mentionsIn(value) {
    const found = new Map(mentioned.current);
    for (const p of members) {
      for (const shown of [atName(p.name), p.username && `@${p.username}`]) {
        if (shown && !found.has(shown) && value.includes(shown)) found.set(shown, mentionToken(p));
      }
    }
    return found;
  }

  // "@Name" back to tokens, longest names first so "@Ann" can't eat part of "@Ann Lee".
  function withTokens(value) {
    const pairs = [...mentionsIn(value)].sort((a, b) => b[0].length - a[0].length);
    const out = pairs.reduce((s, [shown, token]) => s.split(shown).join(token), value);
    mentioned.current = new Map();
    return out;
  }

  /** Call on every change, with the caret. */
  function find(value, caret) {
    const m = members.length && /(^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret));
    setMention(m ? { start: caret - m[2].length - 1, end: caret, q: m[2].toLowerCase() } : null);
    setIndex(0);
  }

  function pick(p) {
    const shown = atName(p.name);
    mentioned.current.set(shown, mentionToken(p));
    const next = `${text.slice(0, mention.start)}${shown} ${text.slice(mention.end)}`;
    const caret = mention.start + shown.length + 1;
    update(next);
    setMention(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(caret, caret);
    });
  }

  /** Arrow keys / Enter / Tab / Escape while the list is open; true when the key was used. */
  function onKeyDown(e) {
    if (!candidates.length) return false;
    const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (move) {
      e.preventDefault();
      setIndex((i) => (i + move + candidates.length) % candidates.length);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(candidates[index] || candidates[0]);
      return true;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      setMention(null);
      return true;
    }
    return false;
  }

  /** Remembers the "@Name" shown for a token (when loading a message to edit). */
  function remember(shown, token) {
    mentioned.current.set(shown, token);
  }

  // The text with its mentions coloured, drawn behind the (transparent) box.
  const highlighted = (() => {
    const shownNames = [...mentionsIn(text).keys()].sort((a, b) => b.length - a.length);
    if (!shownNames.length) return text;
    const re = new RegExp(`(${shownNames.map(escapeRegExp).join('|')})`, 'g');
    return text.split(re).map((part, i) => (shownNames.includes(part) ? <mark key={i} className="mention">{part}</mark> : part));
  })();

  const picker =
    candidates.length > 0 ? (
      <div className="mention-picker" role="listbox" aria-label="Mention someone">
        {candidates.map((p, i) => (
          <button
            key={p.id}
            role="option"
            aria-selected={i === index}
            className={i === index ? 'active' : ''}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(p)}
          >
            <Avatar name={p.name} url={p.avatarUrl} size={32} />
            <span className="mention-name">{p.name}</span>
            {p.username && p.name !== `@${p.username}` && <span className="mention-sub">@{p.username}</span>}
          </button>
        ))}
      </div>
    ) : null;

  return { find, onKeyDown, withTokens, remember, highlighted, picker, close: () => setMention(null) };
}
