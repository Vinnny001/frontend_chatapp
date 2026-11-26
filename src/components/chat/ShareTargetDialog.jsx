import { useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Check, FileText, Send } from 'lucide-react';
import Modal from '../common/Modal.jsx';
import Avatar from '../common/Avatar.jsx';
import { removeNativeFile } from '../../lib/deviceFiles.js';
import { fileKind } from '../../lib/format.js';
import { useAuth } from '../../store/auth.js';
import { canSendIn, chatAvatarUrl, conversationTitle, useChat } from '../../store/chat.js';
import { toast, useUI } from '../../store/ui.js';

const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Something was shared to ChatApp from another app (Android's share sheet): its files, copied
 * into the app's storage by MainActivity, and/or text. Waits for a chat to be picked.
 */
export async function receiveShare({ files = [], text = '', skipped = 0 }) {
  const list = [];
  for (const f of files) {
    try {
      const blob = await fetch(Capacitor.convertFileSrc(`file://${f.absolute}`)).then((r) => r.blob());
      list.push(new File([blob], f.name, { type: f.mime || blob.type }));
    } catch {
      skipped++;
    }
    removeNativeFile(f.path);
  }
  if (skipped) toast(`${skipped} ${skipped === 1 ? 'file' : 'files'} couldn’t be shared (larger than 50 MB, or not readable)`, 'error');
  if (!list.length && !text) return;
  useUI.getState().setIncomingShare({ files: list, text });
}

/** "Send to…": pick up to 5 chats for what another app shared. */
export default function ShareTargetDialog() {
  const share = useUI((s) => s.incomingShare);
  const conversations = useChat((s) => s.conversations);
  const me = useAuth((s) => s.user?.id);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [caption, setCaption] = useState(null);

  const list = useMemo(
    () =>
      Object.values(conversations)
        .filter((c) => canSendIn(c, me) && !c.me?.archived)
        .filter((c) => conversationTitle(c, me).toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => Date.parse(b.lastMessageAt || 0) - Date.parse(a.lastMessageAt || 0)),
    [conversations, me, query]
  );

  if (!share) return null;
  const files = share.files.filter((f) => f.size <= MAX_BYTES);
  const text = caption ?? share.text ?? '';

  const close = () => {
    useUI.getState().setIncomingShare(null);
    setSelected([]);
    setQuery('');
    setCaption(null);
  };
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 5 ? s : [...s, id]));

  function send() {
    const chat = useChat.getState();
    if (selected.length === 1) {
      // One chat: open it with the files ready to look at and send (or the text typed in).
      const [id] = selected;
      chat.openConversation(id);
      if (files.length) chat.setComposer(id, { sharedFiles: files, sharedCaption: text, sharedAt: Date.now() });
      else chat.setComposer(id, { draft: text, prefilledAt: Date.now() });
    } else {
      for (const id of selected) {
        if (files.length) files.forEach((f, i) => chat.sendMedia(id, f, { type: fileKind(f), text: i === 0 ? text : '' }));
        else chat.sendMessage(id, { text });
      }
      toast(`Sent to ${selected.length} chats`);
    }
    close();
  }

  const what = files.length
    ? `${files.length} ${files.length === 1 ? 'file' : 'files'}: ${files.map((f) => f.name).join(', ')}`
    : '';

  return (
    <Modal
      title="Send to…"
      onClose={close}
      className="share-target"
      footer={
        <>
          <span className="hint">{selected.length ? `${selected.length} selected` : 'Choose a chat'}</span>
          <button className="send-btn" disabled={!selected.length || (!files.length && !text.trim())} onClick={send} aria-label="Send">
            <Send size={20} />
          </button>
        </>
      }
    >
      <div className="share-target-what">
        {files.length > 0 && (
          <p className="share-target-files">
            <FileText size={16} /> {what}
          </p>
        )}
        <textarea
          rows={files.length ? 1 : 3}
          value={text}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={files.length ? 'Add a caption' : 'Message'}
          aria-label={files.length ? 'Caption' : 'Message'}
        />
      </div>
      <div className="panel-search">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" />
      </div>
      {list.map((c) => {
        const on = selected.includes(c.id);
        const title = conversationTitle(c, me);
        return (
          <button key={c.id} className={`person-row ${on ? 'selected' : ''}`} onClick={() => toggle(c.id)}>
            <Avatar name={title} url={chatAvatarUrl(c, me)} group={c.type === 'group'} size={40} />
            <span className="person-info">
              <span className="person-name">{title}</span>
            </span>
            <span className={`check ${on ? 'on' : ''}`}>{on && <Check size={14} />}</span>
          </button>
        );
      })}
    </Modal>
  );
}
