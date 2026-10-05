import { useEffect, useState } from 'react';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from 'lucide-react';
import Avatar from '../common/Avatar.jsx';
import SidePanel from './SidePanel.jsx';
import { api } from '../../lib/api.js';
import { formatListTime } from '../../lib/format.js';
import { useAuth } from '../../store/auth.js';
import { useCall } from '../../store/call.js';
import { useGroupCall } from '../../store/groupCall.js';
import { callSummary, conversationTitle, peerOf, useChat } from '../../store/chat.js';
import { toast, useUI } from '../../store/ui.js';

/** Call history, newest first: who called, missed calls, and a button to call back. */
export default function CallsPanel() {
  const [calls, setCalls] = useState(null);
  const me = useAuth((s) => s.user?.id);
  const conversations = useChat((s) => s.conversations);
  const closePanel = useUI((s) => s.closePanel);

  useEffect(() => {
    api('/api/conversations/calls')
      .then((d) => setCalls(d.calls))
      .catch((e) => {
        toast(e.status === 0 ? 'Connect to the internet to see your calls' : e.message, 'error');
        setCalls([]);
      });
  }, []);

  function open(m) {
    useChat.getState().openConversation(m.conversationId);
    closePanel();
  }

  return (
    <SidePanel title="Calls">
      {calls === null && <p className="panel-empty">Loading…</p>}
      {calls?.length === 0 && (
        <div className="panel-empty big">
          <Phone size={40} />
          <p>Your voice and video calls, and the calls you missed, show up here.</p>
        </div>
      )}
      {calls?.map((m) => {
        const conv = conversations[m.conversationId];
        if (!conv) return null;
        const peer = peerOf(conv, me);
        const { title, detail, missed, outgoing } = callSummary(m, me);
        const Icon = missed ? PhoneMissed : outgoing ? PhoneOutgoing : PhoneIncoming;
        const KindIcon = m.call.kind === 'video' ? Video : Phone;
        return (
          <div key={m.id} className="call-row" role="button" tabIndex={0} onClick={() => open(m)}>
            <Avatar name={conversationTitle(conv, me)} url={peer?.avatarUrl} size={46} />
            <span className="call-row-body">
              <span className={`call-row-name ${missed ? 'missed' : ''}`}>{conversationTitle(conv, me)}</span>
              <span className="call-row-meta">
                <Icon size={14} className={missed ? 'missed' : 'ok'} />
                {title}
                {detail ? ` · ${detail}` : ''} · {formatListTime(m.createdAt)}
              </span>
            </span>
            {(peer || conv.type === 'group') && (
              <button
                className="icon-btn"
                aria-label={m.call.kind === 'video' ? 'Video call' : 'Voice call'}
                onClick={(e) => {
                  e.stopPropagation();
                  closePanel();
                  if (conv.type === 'group') useGroupCall.getState().join(conv.id, m.call.kind);
                  else useCall.getState().startCall(conv.id, peer, m.call.kind);
                }}
              >
                <KindIcon size={20} />
              </button>
            )}
          </div>
        );
      })}
    </SidePanel>
  );
}
