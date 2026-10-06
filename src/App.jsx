import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useAuth } from './store/auth.js';
import { useChat } from './store/chat.js';
import { useUI } from './store/ui.js';
import { useRealtime } from './lib/useRealtime.js';
import AuthScreen from './components/AuthScreen.jsx';
import VerifyEmailScreen from './components/VerifyEmailScreen.jsx';
import Sidebar from './components/sidebar/Sidebar.jsx';
import ChatView from './components/chat/ChatView.jsx';
import EmptyChat from './components/chat/EmptyChat.jsx';
import InfoPanel from './components/info/InfoPanel.jsx';
import CallOverlay from './components/call/CallOverlay.jsx';
import GroupCallOverlay from './components/call/GroupCallOverlay.jsx';
import { useGroupCall } from './store/groupCall.js';
import MediaViewer from './components/common/MediaViewer.jsx';
import ForwardDialog from './components/chat/ForwardDialog.jsx';
import PhoneMenu from './components/chat/PhoneMenu.jsx';
import Toasts from './components/common/Toasts.jsx';
import InAppBanner from './components/common/InAppBanner.jsx';
import ProfilePreview from './components/sidebar/ProfilePreview.jsx';
import AdminPanel from './components/admin/AdminPanel.jsx';
import JoinGroupDialog from './components/chat/JoinGroupDialog.jsx';
import { ViewOnceViewer } from './components/chat/ViewOnce.jsx';
import { inviteCodeOf } from './lib/invites.js';
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
      if (ui.viewOnce) ui.setViewOnce(null);
      else if (ui.joinCode) ui.setJoinCode(null);
      else if (ui.profilePreview) ui.setProfilePreview(null);
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

/** Group invite links opened from other apps (chatapp://join/<code>), also on a cold start. */
function useInviteLinks() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    const open = (url) => {
      const code = inviteCodeOf(url);
      if (code) useUI.getState().setJoinCode(code);
    };
    CapacitorApp.getLaunchUrl()
      .then((r) => open(r?.url))
      .catch(() => {});
    const handle = CapacitorApp.addListener('appUrlOpen', ({ url }) => open(url));
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
  const inGroupCall = useGroupCall((s) => !!s.active);
  useEffect(() => {
    nativeCallScreenShown();
  }, []);
  return (
    <div className="locked-call">
      {inGroupCall ? <GroupCallOverlay /> : hasCall ? <CallOverlay /> : <p className="locked-call-wait">Connecting call…</p>}
    </div>
  );
}

function Messenger({ token }) {
  useRealtime(token);
  useBackButton();
  useInviteLinks();
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
      <GroupCallOverlay />
      <MediaViewer />
      <ForwardDialog />
      <PhoneMenu />
      <InAppBanner />
      <ProfilePreview />
      <AdminPanel />
      <JoinGroupDialog />
      <ViewOnceViewer />
    </div>
  );
}

export default function App() {
  const token = useAuth((s) => s.token);
  // Signed up (or signed in) but the email isn't confirmed yet: only the code screen.
  const emailPending = useAuth((s) => s.user?.emailVerified === false);
  useTheme();
  return (
    <>
      {!token ? <AuthScreen /> : emailPending ? <VerifyEmailScreen /> : <Messenger token={token} />}
      <Toasts />
    </>
  );
}
