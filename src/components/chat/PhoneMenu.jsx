import { useEffect, useState } from 'react';
import { Copy, MessageCircle, Phone, UserPlus } from 'lucide-react';
import Menu from '../common/Menu.jsx';
import Avatar from '../common/Avatar.jsx';
import { invite, lookupPhone } from '../../lib/contacts.js';
import { useChat } from '../../store/chat.js';
import { displayName, handleOf } from '../../store/people.js';
import { toast, useUI } from '../../store/ui.js';

/** Opened by tapping a phone number in a message: chat with them if registered, otherwise invite. */
export default function PhoneMenu() {
  const menu = useUI((s) => s.phoneMenu);
  const close = useUI((s) => s.closePhoneMenu);
  const [state, setState] = useState({ status: 'idle' });

  useEffect(() => {
    if (!menu) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });
    lookupPhone(menu.phone)
      .then((match) => !cancelled && setState(match ? { status: 'found', match } : { status: 'none' }))
      .catch(() => !cancelled && setState({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [menu]);

  if (!menu) return null;
  const { phone } = menu;
  const dial = phone.replace(/[^\d+]/g, '');
  // I tapped their number, so I know it even if they keep it private.
  const user = state.match?.user && { ...state.match.user, phone: state.match.user.phone || phone };
  const name = user ? displayName(user) : '';

  const call = { label: `Call ${phone}`, icon: Phone, onClick: () => (window.location.href = `tel:${dial}`) };
  const copy = {
    label: 'Copy number',
    icon: Copy,
    onClick: () => navigator.clipboard?.writeText(phone).then(() => toast('Number copied')),
  };

  let header;
  let items = [];
  if (state.status === 'loading' || state.status === 'idle') {
    header = <div className="menu-header">Checking {phone}…</div>;
  } else if (state.status === 'found' && state.match.self) {
    header = <div className="menu-header">This is your number</div>;
    items = [
      {
        label: 'Message yourself',
        icon: MessageCircle,
        onClick: () => useChat.getState().openDirect(state.match.user.id).catch((e) => toast(e.message, 'error')),
      },
      copy,
    ];
  } else if (state.status === 'found') {
    header = (
      <div className="menu-header person">
        <Avatar name={name} url={user.avatarUrl} size={36} />
        <span>
          <strong>{name}</strong>
          {handleOf(user) && handleOf(user) !== name && <small>{handleOf(user)}</small>}
          <small>{phone} is on ChatApp</small>
        </span>
      </div>
    );
    items = [
      {
        label: `Message ${name.startsWith('@') || name.startsWith('+') ? name : name.split(' ')[0]}`,
        icon: MessageCircle,
        onClick: () => useChat.getState().openDirect(user.id).catch((e) => toast(e.message, 'error')),
      },
      call,
      copy,
    ];
  } else if (state.status === 'none') {
    header = <div className="menu-header">{phone} isn’t on ChatApp yet</div>;
    items = [{ label: 'Invite to ChatApp', icon: UserPlus, onClick: () => invite(phone) }, call, copy];
  } else {
    header = <div className="menu-header">Couldn’t check this number (offline?)</div>;
    items = [call, copy];
  }

  return <Menu x={menu.x} y={menu.y} header={header} items={items} onClose={close} />;
}
