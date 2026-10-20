import { useEffect } from 'react';
import { Copy, Star, Trash2, X } from 'lucide-react';
import { plainMentions } from '../../lib/mentions.js';
import { useAuth } from '../../store/auth.js';
import { useChat } from '../../store/chat.js';
import { toast } from '../../store/ui.js';

const two = (n) => String(n).padStart(2, '0');
/** "[10/20, 13:28]" as in WhatsApp's copied messages. */
const stamp = (iso) => {
  const d = new Date(iso);
  return `[${d.getMonth() + 1}/${d.getDate()}, ${two(d.getHours())}:${two(d.getMinutes())}]`;
};

/**
 * Several messages selected (Select in a message's menu): copy them (when they're all text),
 * star or delete them for me. Takes the chat header's place.
 */
export default function SelectionBar({ conv }) {
  const selection = useChat((s) => (s.selection?.convId === conv.id ? s.selection : null));
  const items = useChat((s) => s.threads[conv.id]?.items || []);
  const me = useAuth((s) => s.user);
  const { clearSelection, toggleStar, deleteMessage } = useChat.getState();

  // Escape ends the selection (so does opening another chat, see the store).
  useEffect(() => {
    if (!selection) return undefined;
    const onKey = (e) => e.key === 'Escape' && clearSelection();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, clearSelection]);

  if (!selection) return null;
  const chosen = items.filter((m) => selection.ids.includes(m.id)).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const allText = chosen.length > 0 && chosen.every((m) => m.type === 'text' && m.text && !m.deletedForEveryone && !m.poll && !m.viewOnce);
  const nameOf = (m) => (m.sender === me?.id ? me?.name || 'You' : conv.participants.find((p) => p.id === m.sender)?.name || 'Someone');

  async function copy() {
    const text =
      chosen.length === 1
        ? plainMentions(chosen[0].text, conv, me?.id)
        : chosen.map((m) => `${stamp(m.createdAt)} ${nameOf(m)}: ${plainMentions(m.text, conv, me?.id)}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast(chosen.length === 1 ? 'Copied' : `${chosen.length} messages copied`);
      clearSelection();
    } catch {
      toast('Could not copy', 'error');
    }
  }

  return (
    <header className="chat-header selection-bar">
      <button className="icon-btn" onClick={clearSelection} aria-label="Cancel selection">
        <X size={22} />
      </button>
      <strong className="selection-count">{selection.ids.length} selected</strong>
      <button className="icon-btn" onClick={copy} disabled={!allText} aria-label="Copy" title={allText ? 'Copy' : 'Only text messages can be copied'}>
        <Copy size={20} />
      </button>
      <button
        className="icon-btn"
        aria-label="Star"
        title="Star"
        onClick={async () => {
          for (const m of chosen) if (!m.starred) await toggleStar(m);
          clearSelection();
        }}
      >
        <Star size={20} />
      </button>
      <button
        className="icon-btn"
        aria-label="Delete for me"
        title="Delete for me"
        onClick={async () => {
          if (!window.confirm(`Delete ${chosen.length} message${chosen.length === 1 ? '' : 's'} for you?`)) return;
          for (const m of chosen) await deleteMessage(m, false);
          clearSelection();
        }}
      >
        <Trash2 size={20} />
      </button>
    </header>
  );
}
