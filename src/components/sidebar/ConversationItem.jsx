import { memo } from 'react';
import { Archive, ArchiveRestore, BellOff, Bell, CheckCheck, ChevronDown, Pin, PinOff } from 'lucide-react';
import Avatar from '../common/Avatar.jsx';
import Ticks from '../common/Ticks.jsx';
import Menu, { useContextMenu } from '../common/Menu.jsx';
import { formatListTime } from '../../lib/format.js';
import { useUI } from '../../store/ui.js';
import { chatAvatarUrl, conversationTitle, isSelfChat, messageStatus, peerOf, previewText, reactionPreview, useChat, isOnlineSelector } from '../../store/chat.js';

function ConversationItem({ conv, me, active }) {
  const typing = useChat((s) => s.typing[conv.id]);
  const draft = useChat((s) => s.composer[conv.id]?.draft);
  const peer = peerOf(conv, me);
  const online = useChat(isOnlineSelector(peer?.id));
  const { openConversation, setPrefs, markRead } = useChat.getState();
  const { menu, open, close, longPress } = useContextMenu();

  const title = conversationTitle(conv, me);
  const last = conv.lastMessage;
  const unread = conv.me?.unreadCount || 0;
  const typers = Object.entries(typing || {}).filter(([id]) => id !== me);

  let preview;
  if (typers.length) {
    const [userId, state] = typers[0];
    const who = conv.type === 'group' ? `${conv.participants.find((p) => p.id === userId)?.name?.split(' ')[0] || 'Someone'} is ` : '';
    preview = <span className="typing-text">{who}{state === 'recording' ? 'recording audio…' : 'typing…'}</span>;
  } else if (draft?.trim() && !active) {
    preview = (
      <span>
        <span className="draft-label">Draft: </span>
        {draft}
      </span>
    );
  } else if (reactionPreview(conv, me)) {
    preview = <span>{reactionPreview(conv, me)}</span>;
  } else if (last) {
    const mine = last.sender === me;
    const senderName =
      conv.type === 'group' && last.sender && last.type !== 'system'
        ? mine
          ? 'You: '
          : `${conv.participants.find((p) => p.id === last.sender)?.name?.split(' ')[0] || 'Someone'}: `
        : '';
    preview = (
      <>
        {mine && last.type !== 'system' && last.type !== 'call' && <Ticks status={messageStatus(last, conv, me)} size={15} />}
        <span className={last.deletedForEveryone ? 'muted-italic' : ''}>
          {senderName}
          {previewText(last)}
        </span>
      </>
    );
  } else {
    preview = <span className="muted-italic">{conv.type === 'group' ? 'Group created' : isSelfChat(conv, me) ? 'Message yourself' : 'Say hi 👋'}</span>;
  }

  const menuItems = [
    unread > 0 && { label: 'Mark as read', icon: CheckCheck, onClick: () => markRead(conv.id) },
    { label: conv.me?.pinned ? 'Unpin chat' : 'Pin chat', icon: conv.me?.pinned ? PinOff : Pin, onClick: () => setPrefs(conv.id, { pinned: !conv.me?.pinned }) },
    { label: conv.me?.muted ? 'Unmute notifications' : 'Mute notifications', icon: conv.me?.muted ? Bell : BellOff, onClick: () => setPrefs(conv.id, { muted: !conv.me?.muted }) },
    { label: conv.me?.archived ? 'Unarchive chat' : 'Archive chat', icon: conv.me?.archived ? ArchiveRestore : Archive, onClick: () => setPrefs(conv.id, { archived: !conv.me?.archived }) },
  ];

  return (
    <>
      <div
        className={`conv-item ${active ? 'active' : ''} ${unread ? 'unread' : ''}`}
        onClick={() => openConversation(conv.id)}
        onContextMenu={open}
        {...longPress}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && openConversation(conv.id)}
      >
        <Avatar
          name={title}
          url={chatAvatarUrl(conv, me)}
          online={online}
          group={conv.type === 'group'}
          size={50}
          onClick={(e) => {
            e.stopPropagation(); // the photo opens the profile preview, not the chat
            useUI.getState().setProfilePreview(conv.id);
          }}
        />
        <div className="conv-body">
          <div className="conv-top">
            <span className="conv-title">{title}</span>
            <span className="conv-time">{formatListTime(last?.createdAt || conv.lastMessageAt)}</span>
          </div>
          <div className="conv-bottom">
            <span className="conv-preview">{preview}</span>
            <span className="conv-badges">
              {conv.me?.muted && <BellOff size={15} className="muted-icon" />}
              {conv.me?.pinned && <Pin size={15} className="muted-icon" />}
              {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
              <button className="conv-menu-btn" onClick={open} aria-label="Chat options">
                <ChevronDown size={18} />
              </button>
            </span>
          </div>
        </div>
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={menuItems} onClose={close} />}
    </>
  );
}

export default memo(ConversationItem);
