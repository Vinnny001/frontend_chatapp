import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useAuth } from './store/auth.js';
import { useChat } from './store/chat.js';
import { useUI } from './store/ui.js';
import { useRealtime } from './lib/useRealtime.js';
import AuthScreen from './components/AuthScreen.jsx';
import Sidebar from './components/sidebar/Sidebar.jsx';
import ChatView from './components/chat/ChatView.jsx';
import EmptyChat from './components/chat/EmptyChat.jsx';
import InfoPanel from './components/info/InfoPanel.jsx';
import CallOverlay from './components/call/CallOverlay.jsx';
import MediaViewer from './components/common/MediaViewer.jsx';
import ForwardDialog from './components/chat/ForwardDialog.jsx';
import PhoneMenu from './components/chat/PhoneMenu.jsx';
import Toasts from './components/common/Toasts.jsx';
import InAppBanner from './components/common/InAppBanner.jsx';
import ProfilePreview from './components/sidebar/ProfilePreview.jsx';
import { useCall } from './store/call.js';
import { nativeCallScreenShown } from './lib/native.js';

function useTheme() {
  const theme = useUI((s) => s.theme);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#111b21' : '#0b8f6a');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}

/** Android hardware back button: close overlays first, then the open chat, then exit. */
function useBackButton() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    const handle = CapacitorApp.addListener('backButton', () => {
      const ui = useUI.getState();
      const chat = useChat.getState();
      if (ui.profilePreview) ui.setProfilePreview(null);
      else if (ui.phoneMenu) ui.closePhoneMenu();
      else if (ui.viewer) ui.closeViewer();
      else if (ui.forwarding) ui.setForwarding(null);
      else if (ui.infoOpen) ui.setInfoOpen(false);
      else if (ui.panel) ui.closePanel();
      else if (chat.activeId) chat.closeConversation();
      else CapacitorApp.exitApp();
    });
    return () => {
      handle.then((h) => h.remove());
    };
  }, []);
}

/**
 * A call answered while the phone is locked: only the call, never the chats (a stranger
 * holding the phone can't get past it). The native cover is lifted once this is on screen.
 */
function LockedCall() {
  const hasCall = useCall((s) => !!s.call);
  useEffect(() => {
    nativeCallScreenShown();
  }, []);
  return (
    <div className="locked-call">
      {hasCall ? <CallOverlay /> : <p className="locked-call-wait">Connecting call…</p>}
    </div>
  );
}

function Messenger({ token }) {
  useRealtime(token);
  useBackButton();
  const activeId = useChat((s) => s.activeId);
  const infoOpen = useUI((s) => s.infoOpen);
  const lockedCall = useCall((s) => !!s.external?.locked);

  if (lockedCall) return <LockedCall />;

  return (
    <div className={`app ${activeId ? 'has-chat' : ''} ${infoOpen && activeId ? 'has-info' : ''}`}>
      <Sidebar />
      <main className="chat-area">{activeId ? <ChatView key={activeId} convId={activeId} /> : <EmptyChat />}</main>
      {infoOpen && activeId && <InfoPanel convId={activeId} />}
      <CallOverlay />
      <MediaViewer />
      <ForwardDialog />
      <PhoneMenu />
      <InAppBanner />
      <ProfilePreview />
    </div>
  );
}

export default function App() {
  const token = useAuth((s) => s.token);
  useTheme();
  return (
    <>
      {token ? <Messenger token={token} /> : <AuthScreen />}
      <Toasts />
    </>
  );
}
