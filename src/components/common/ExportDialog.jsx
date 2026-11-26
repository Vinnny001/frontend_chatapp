import { useMemo, useState } from 'react';
import { FileJson, FolderDown, Share2 } from 'lucide-react';
import Avatar from './Avatar.jsx';
import Modal from './Modal.jsx';
import { exportChats } from '../../lib/exportChats.js';
import { formatBytes } from '../../lib/format.js';
import { canShareFiles, saveToDevice, shareFile } from '../../lib/share.js';
import { useAuth } from '../../store/auth.js';
import { chatAvatarUrl, conversationTitle, useChat } from '../../store/chat.js';
import { toast } from '../../store/ui.js';

const day = (d) => d.toISOString().slice(0, 10);

/**
 * Export chats as JSON (made on this device: messages are end-to-end encrypted).
 *  - `conv` given (from a chat's info): that chat, the whole of it or between two dates.
 *  - no `conv` (from the chat list menu): pick some chats or all of them; whole history.
 * Once made, the file is saved on the phone (Files app) or shared to another app.
 */
export default function ExportDialog({ conv, onClose }) {
  const me = useAuth((s) => s.user?.id);
  const conversations = useChat((s) => s.conversations);
  const chats = useMemo(
    () =>
      Object.values(conversations)
        .filter((c) => c.lastMessage || c.type === 'group')
        .sort((a, b) => Date.parse(b.lastMessageAt || 0) - Date.parse(a.lastMessageAt || 0)),
    [conversations]
  );
  const [whole, setWhole] = useState(true);
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 30 * 864e5)));
  const [to, setTo] = useState(() => day(new Date()));
  const [picked, setPicked] = useState(() => new Set());
  const [progress, setProgress] = useState(null); // { done, total }
  const [file, setFile] = useState(null); // { blob, name } once made
  const [handing, setHanding] = useState(false);

  const busy = !!progress || handing;
  const allPicked = chats.length > 0 && picked.size === chats.length;
  const toggle = (id) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function run() {
    const list = conv ? [conv] : chats.filter((c) => picked.has(c.id));
    if (!list.length) return toast('Choose at least one chat');
    if (conv && !whole && from > to) return toast('The start date is after the end date');
    // (Dates are whole days in local time.)
    const range = conv && !whole ? { from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59.999`).toISOString() } : {};
    setProgress({ done: 0, total: list.length });
    try {
      const { blob, name } = await exportChats(list, me, { range, onProgress: (done, total) => setProgress({ done, total }) });
      setFile({ blob, name });
    } catch (e) {
      toast(e.message || 'Export failed', 'error');
    }
    setProgress(null);
    return undefined;
  }

  async function save() {
    setHanding(true);
    try {
      const where = await saveToDevice(file.blob, file.name);
      if (where) toast(`Saved to ${where}: ${file.name}`);
      onClose();
    } catch (e) {
      if (e?.code !== 'CANCELLED' && e?.message !== 'Cancelled') toast(e.message || 'Couldn’t save the file', 'error');
    }
    setHanding(false);
  }

  async function share() {
    setHanding(true);
    try {
      await shareFile(file.blob, file.name, { title: 'Export chat' });
    } catch (e) {
      toast(e.message, 'error');
    }
    setHanding(false);
  }

  if (file) {
    return (
      <Modal
        title="Chat exported"
        onClose={handing ? () => {} : onClose}
        className="export-dialog"
        footer={
          <button className="btn btn-ghost" onClick={onClose} disabled={handing}>
            Done
          </button>
        }
      >
        <div className="export-file">
          <FileJson size={34} />
          <span>
            <strong>{file.name}</strong>
            <small>{formatBytes(file.blob.size)}</small>
          </span>
        </div>
        <div className="export-actions">
          <button className="btn btn-primary" onClick={save} disabled={handing}>
            <FolderDown size={18} /> Save to phone
          </button>
          {canShareFiles() && (
            <button className="btn btn-ghost" onClick={share} disabled={handing}>
              <Share2 size={18} /> Share
            </button>
          )}
        </div>
        <p className="hint">
          “Save to phone” puts it in Downloads/ChatApp, where your Files app finds it. To read the chats in ChatApp again
          (on another device, or after erasing this one), use “Import chats” in the chat list menu.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title={conv ? 'Export chat' : 'Export chats'}
      onClose={busy ? () => {} : onClose}
      className="export-dialog"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={run} disabled={busy || (!conv && !picked.size)}>
            {progress ? (progress.total > 1 ? `Exporting ${progress.done + 1} of ${progress.total}…` : 'Exporting…') : 'Export'}
          </button>
        </>
      }
    >
      <p className="hint">
        A JSON file with the messages (decrypted on this device). Photos, videos and documents are listed by name, not
        included.
      </p>
      {conv ? (
        <>
          <p className="export-chat-name">{conversationTitle(conv, me)}</p>
          <label className="radio-row">
            <input type="radio" name="range" checked={whole} onChange={() => setWhole(true)} disabled={busy} /> Full chat
          </label>
          <label className="radio-row">
            <input type="radio" name="range" checked={!whole} onChange={() => setWhole(false)} disabled={busy} /> Date range
          </label>
          {!whole && (
            <div className="export-range">
              <label>
                From
                <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} disabled={busy} />
              </label>
              <label>
                To
                <input type="date" value={to} min={from} max={day(new Date())} onChange={(e) => setTo(e.target.value)} disabled={busy} />
              </label>
            </div>
          )}
        </>
      ) : (
        <>
          <label className="export-row export-all">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={() => setPicked(allPicked ? new Set() : new Set(chats.map((c) => c.id)))}
              disabled={busy}
            />
            <strong>All chats</strong>
            <span className="export-count">{picked.size ? `${picked.size} selected` : ''}</span>
          </label>
          <div className="export-list">
            {chats.map((c) => (
              <label key={c.id} className="export-row">
                <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} disabled={busy} />
                <Avatar name={conversationTitle(c, me)} url={chatAvatarUrl(c, me)} group={c.type === 'group'} size={34} />
                <span className="export-name">{conversationTitle(c, me)}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
