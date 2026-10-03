import Avatar from './Avatar.jsx';
import { useChat } from '../../store/chat.js';
import { useUI } from '../../store/ui.js';

/** WhatsApp-style in-app notification: who, what; tap to open the chat. */
export default function InAppBanner() {
  const banner = useUI((s) => s.banner);
  if (!banner) return null;
  const open = () => {
    useUI.getState().hideBanner();
    useChat.getState().openConversation(banner.conversationId);
  };
  return (
    <button key={banner.id} className="in-app-banner" onClick={open}>
      <Avatar name={banner.title} url={banner.avatarUrl} size={40} />
      <span className="in-app-banner-text">
        <strong>{banner.title}</strong>
        <span>{banner.text}</span>
      </span>
    </button>
  );
}
