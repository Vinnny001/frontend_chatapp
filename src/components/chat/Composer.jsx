import { useEffect, useRef, useState } from 'react';
import { Camera, Check, FileText, Image, Mic, Paperclip, Pencil, Reply, Send, Smile, Trash2, X } from 'lucide-react';
import EmojiPicker from './EmojiPicker.jsx';
import AttachmentPreview from './AttachmentPreview.jsx';
import Menu from '../common/Menu.jsx';
import { fileKind, formatDuration } from '../../lib/format.js';
import { useAuth } from '../../store/auth.js';
import { canSendIn, useChat } from '../../store/chat.js';
import { toast, useUI } from '../../store/ui.js';

const TYPING_THROTTLE_MS = 2500;
const TYPING_IDLE_MS = 4000;

function pickRecorderType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return types.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
}

function useVoiceRecorder(onDone, onState) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef(null);

  async function start() {
    const mimeType = pickRecorderType();
    if (mimeType === null || !navigator.mediaDevices?.getUserMedia) return toast('Voice notes are not supported here', 'error');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return toast('Microphone permission denied', 'error');
    }
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    const startedAt = Date.now();
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(rec.current?.timer);
      const { cancelled } = rec.current || {};
      rec.current = null;
      setRecording(false);
      setElapsed(0);
      onState('stop');
      const duration = (Date.now() - startedAt) / 1000;
      if (cancelled || duration < 0.6) return;
      const type = recorder.mimeType || chunks[0]?.type || 'audio/webm';
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      onDone(new File(chunks, `voice-${Date.now()}.${ext}`, { type: type.split(';')[0] }), duration);
    };
    recorder.start(250);
    rec.current = {
      recorder,
      cancelled: false,
      timer: setInterval(() => {
        setElapsed((Date.now() - startedAt) / 1000);
        onState('recording');
      }, 500),
    };
    setRecording(true);
    onState('recording');
  }

  const stop = (cancel = false) => {
    if (!rec.current) return;
    rec.current.cancelled = cancel;
    rec.current.recorder.stop();
  };

  useEffect(() => () => stop(true), []);
  return { recording, elapsed, start, stop };
}

export default function Composer({ conv, droppedFiles, onDroppedHandled }) {
  const me = useAuth((s) => s.user?.id);
  const state = useChat((s) => s.composer[conv.id]) || {};
  const { sendMessage, sendMedia, editMessage, setComposer, sendTyping } = useChat.getState();
  const enterToSend = useUI((s) => s.enterToSend);
  const [text, setText] = useState(() => state.draft || '');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachMenu, setAttachMenu] = useState(null);
  const [files, setFiles] = useState(null);
  const input = useRef(null);
  const fileInputs = { media: useRef(null), doc: useRef(null), camera: useRef(null) };
  const typing = useRef({ last: 0, idle: null });

  const { replyTo, editing } = state;

  const setTyping = (st) => {
    clearTimeout(typing.current.idle);
    if (st === 'stop') {
      if (typing.current.last) sendTyping(conv.id, 'stop');
      typing.current.last = 0;
      return;
    }
    const now = Date.now();
    if (now - typing.current.last > TYPING_THROTTLE_MS) {
      sendTyping(conv.id, st);
      typing.current.last = now;
    }
    typing.current.idle = setTimeout(() => setTyping('stop'), TYPING_IDLE_MS);
  };

  const voice = useVoiceRecorder(
    (file, duration) => {
      sendMedia(conv.id, file, { type: 'voice', duration, replyTo });
      setComposer(conv.id, { replyTo: null });
    },
    (st) => (st === 'stop' ? setTyping('stop') : setTyping('recording'))
  );

  // Load the message being edited into the input.
  useEffect(() => {
    if (editing) {
      setText(editing.text);
      input.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    if (droppedFiles?.length) {
      setFiles(droppedFiles);
      onDroppedHandled();
    }
  }, [droppedFiles, onDroppedHandled]);

  // Auto-grow the textarea.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  // Keep the draft when switching chats; stop "typing" when leaving.
  useEffect(
    () => () => {
      clearTimeout(typing.current.idle);
      if (typing.current.last) sendTyping(conv.id, 'stop');
    },
    [conv.id, sendTyping]
  );

  function updateText(value) {
    setText(value);
    if (!editing) setComposer(conv.id, { draft: value });
    if (value) setTyping('typing');
    else setTyping('stop');
  }

  function submit() {
    const body = text.trim();
    if (!body) return;
    if (editing) {
      if (body !== editing.text) editMessage(editing, body);
      setComposer(conv.id, { editing: null });
      setText(state.draft || '');
      return;
    }
    sendMessage(conv.id, { text: body, replyTo });
    setText('');
    setComposer(conv.id, { draft: '', replyTo: null });
    setTyping('stop');
    input.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && enterToSend && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape' && (editing || replyTo)) {
      setComposer(conv.id, { editing: null, replyTo: null });
      if (editing) setText(state.draft || '');
    }
  }

  function onPaste(e) {
    const pasted = [...(e.clipboardData?.files || [])];
    if (pasted.length) {
      e.preventDefault();
      setFiles(pasted);
    }
  }

  function insertEmoji(emoji) {
    const el = input.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    updateText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  function sendFiles(list, caption) {
    list.forEach((file, i) => {
      const kind = fileKind(file);
      if (file.size > 50 * 1024 * 1024) return toast(`${file.name} is larger than 50 MB`, 'error');
      sendMedia(conv.id, file, { type: kind, text: i === 0 ? caption : '', replyTo: i === 0 ? replyTo : null });
    });
    setComposer(conv.id, { replyTo: null });
    setFiles(null);
  }

  if (conv.me?.blocked) {
    const peer = conv.participants.find((p) => p.id !== me);
    return (
      <button
        className="composer-locked blocked"
        onClick={() =>
          useChat
            .getState()
            .setBlocked(peer.id, false)
            .then(() => toast(`${peer.name} unblocked`))
            .catch((e) => toast(e.message, 'error'))
        }
      >
        You blocked this contact. Tap to unblock.
      </button>
    );
  }

  if (!canSendIn(conv, me)) {
    return <div className="composer-locked">Only admins can send messages to this group.</div>;
  }

  const who = replyTo && (replyTo.sender === me ? 'You' : conv.participants.find((p) => p.id === replyTo.sender)?.name || 'Someone');

  return (
    <div className="composer-wrap">
      {(replyTo || editing) && (
        <div className="composer-context">
          {editing ? <Pencil size={18} /> : <Reply size={18} />}
          <div className="composer-context-body">
            <strong>{editing ? 'Edit message' : `Replying to ${who}`}</strong>
            <span>{(editing || replyTo).text || (editing || replyTo).media?.name || 'Media'}</span>
          </div>
          <button
            className="icon-btn"
            onClick={() => {
              setComposer(conv.id, { editing: null, replyTo: null });
              if (editing) setText(state.draft || '');
            }}
            aria-label="Cancel"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {emojiOpen && (
        <div className="composer-emoji">
          <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
        </div>
      )}

      <div className="composer">
        {voice.recording ? (
          <div className="recording">
            <button className="icon-btn danger" onClick={() => voice.stop(true)} aria-label="Cancel recording">
              <Trash2 size={20} />
            </button>
            <span className="rec-dot" />
            <span className="rec-time">{formatDuration(voice.elapsed)}</span>
            <span className="rec-hint">Recording…</span>
          </div>
        ) : (
          <>
            <button className="icon-btn" data-emoji-toggle onClick={() => setEmojiOpen((o) => !o)} aria-label="Emoji">
              <Smile size={22} />
            </button>
            {!editing && (
              <button
                className="icon-btn"
                aria-label="Attach"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setAttachMenu({ x: r.left, y: r.top - 170 });
                }}
              >
                <Paperclip size={21} />
              </button>
            )}
            <textarea
              ref={input}
              rows={1}
              value={text}
              placeholder="Type a message"
              onChange={(e) => updateText(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              maxLength={65536}
              aria-label="Message"
            />
          </>
        )}

        {voice.recording ? (
          <button className="send-btn" onClick={() => voice.stop(false)} aria-label="Send voice message">
            <Send size={20} />
          </button>
        ) : text.trim() ? (
          <button className="send-btn" onClick={submit} aria-label={editing ? 'Save edit' : 'Send'}>
            {editing ? <Check size={22} /> : <Send size={20} />}
          </button>
        ) : (
          <button className="send-btn" onClick={voice.start} aria-label="Record voice message">
            <Mic size={21} />
          </button>
        )}
      </div>

      {attachMenu && (
        <Menu
          x={attachMenu.x}
          y={attachMenu.y}
          onClose={() => setAttachMenu(null)}
          items={[
            { label: 'Photos & videos', icon: Image, onClick: () => fileInputs.media.current.click() },
            { label: 'Camera', icon: Camera, onClick: () => fileInputs.camera.current.click() },
            { label: 'Document', icon: FileText, onClick: () => fileInputs.doc.current.click() },
          ]}
        />
      )}
      {[
        ['media', 'image/*,video/*', true, undefined],
        ['camera', 'image/*', false, 'environment'],
        ['doc', '*/*', true, undefined],
      ].map(([key, accept, multiple, capture]) => (
        <input
          key={key}
          ref={fileInputs[key]}
          type="file"
          hidden
          accept={accept}
          multiple={multiple}
          capture={capture}
          onChange={(e) => {
            const list = [...e.target.files];
            e.target.value = '';
            if (list.length) setFiles(list);
          }}
        />
      ))}

      {files && <AttachmentPreview files={files} onCancel={() => setFiles(null)} onSend={sendFiles} />}
    </div>
  );
}
