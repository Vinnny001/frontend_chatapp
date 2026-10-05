import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Info, MessageCircle, Pencil, Phone, Users, Video } from 'lucide-react';
import { initials } from '../../lib/format.js';
import { useMediaSrc } from '../../lib/media.js';
import { useAuth } from '../../store/auth.js';
import { useCall } from '../../store/call.js';
import { chatAvatarUrl, conversationTitle, isSelfChat, peerOf, useChat } from '../../store/chat.js';
import { toast, useUI } from '../../store/ui.js';

/**
 * Tapping a photo in the chat list, like WhatsApp: the photo with the name over it, and
 * Chat / Call / Video / Info. Tap the photo to see it full size. Your own chat: Edit profile.
 */
export default function ProfilePreview() {
  const convId = useUI((s) => s.profilePreview);
  const conv = useChat((s) => (convId ? s.conversations[convId] : null));
  const me = useAuth((s) => s.user?.id);
  const close = () => useUI.getState().setProfilePreview(null);
  const url = conv ? chatAvatarUrl(conv, me) : null;
  const { src } = useMediaSrc(url);

  useEffect(() => {
    if (!convId) return undefined;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [convId]);

  if (!conv) return null;
  const title = conversationTitle(conv, me);
  const group = conv.type === 'group';
  const self = isSelfChat(conv, me);
  const peer = peerOf(conv, me);
  const { openConversation } = useChat.getState();
  const ui = useUI.getState();

  const act = (fn) => () => {
    close();
    fn();
  };
  const call = (kind) =>
    act(() => {
      openConversation(conv.id);
      useCall.getState().startCall(conv.id, { id: peer.id, name: peer.name, avatarUrl: peer.avatarUrl }, kind);
    });

  const actions = [
    { label: 'Chat', icon: MessageCircle, onClick: act(() => openConversation(conv.id)) },
    !group && !self && peer && { label: 'Call', icon: Phone, onClick: call('audio') },
    !group && !self && peer && { label: 'Video', icon: Video, onClick: call('video') },
    self
      ? { label: 'Edit profile', icon: Pencil, onClick: act(() => ui.openPanel('settings')) }
      : {
          label: 'Info',
          icon: Info,
          onClick: act(() => {
            openConversation(conv.id);
            ui.setInfoOpen('info');
          }),
        },
  ].filter(Boolean);

  return createPortal(
    <div className="modal-backdrop profile-preview-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="profile-preview" role="dialog" aria-modal="true" aria-label={title}>
        <button
          className="profile-preview-photo"
          onClick={() => {
            if (!url) return toast(self ? 'Add a profile photo in Edit profile' : 'No profile photo');
            close();
            ui.openViewer({ url, type: 'image', name: title });
          }}
          aria-label="View photo"
        >
          {src ? (
            <img src={src} alt="" />
          ) : (
            <span className="profile-preview-fallback">{group ? <Users size={96} /> : initials(title)}</span>
          )}
          <span className="profile-preview-name">{title}</span>
        </button>
        <div className="profile-preview-actions">
          {actions.map(({ label, icon: Icon, onClick }) => (
            <button key={label} onClick={onClick} aria-label={label} title={label}>
              <Icon size={22} />
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
