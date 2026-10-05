import { useState } from 'react';
import ChatHeader from './ChatHeader.jsx';
import PinnedBar from './PinnedBar.jsx';
import MessageList from './MessageList.jsx';
import Composer from './Composer.jsx';
import EmptyChat from './EmptyChat.jsx';
import { useChat } from '../../store/chat.js';
import { useUI } from '../../store/ui.js';
import { useAuth } from '../../store/auth.js';

export default function ChatView({ convId }) {
  const conv = useChat((s) => s.conversations[convId]);
  const wallpaper = useUI((s) => s.wallpaper);
  const me = useAuth((s) => s.user?.id);
  const [dropFiles, setDropFiles] = useState(null);
  const [dragging, setDragging] = useState(false);

  if (!conv) return <EmptyChat />;

  return (
    <div
      className={`chat wall-${wallpaper}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) setDropFiles([...e.dataTransfer.files]);
      }}
    >
      <ChatHeader conv={conv} />
      {/* A new set of pins starts again from the newest. */}
      <PinnedBar key={`${conv.id}:${(conv.pinned || []).map((p) => p.messageId).join()}`} conv={conv} me={me} />
      <MessageList conv={conv} />
      <Composer conv={conv} droppedFiles={dropFiles} onDroppedHandled={() => setDropFiles(null)} />
      {dragging && <div className="drop-overlay">Drop files to send</div>}
    </div>
  );
}
