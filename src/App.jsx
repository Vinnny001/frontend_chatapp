import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useAuth } from './store/auth.js';
import { useChat } from './store/chat.js';
import { toast, useUI } from './store/ui.js';
import { useRealtime } from './lib/useRealtime.js';
import AuthScreen from './components/AuthScreen.jsx';
import VerifyEmailScreen from './components/VerifyEmailScreen.jsx';
import SyncChoiceScreen from './components/SyncChoiceScreen.jsx';
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
import LoginRequestPrompt from './components/LoginRequestPrompt.jsx';
import E2eeGate, { useE2eeStatus } from './components/E2eeGate.jsx';
import StatusViewer from './components/status/StatusViewer.jsx';
import StatusComposer from './components/status/StatusComposer.jsx';
import { useStatus } from './store/status.js';
import { inviteCodeOf } from './lib/invites.js';
import { chatLinkOf } from './lib/chatLinks.js';
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
      const status = useStatus.getState();
      if (status.viewer) status.closeViewer();
      else if (status.composing) status.compose(null);
      else if (ui.viewOnce) ui.setViewOnce(null);
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

/**
 * Links that open the app: group invites (…/join/<code>) and chat links (…/chat/<who>?text=),
 * from other apps on the phone (also on a cold start) or, on the web, this page's address.
 */
function openAppLink(url) {
  const code = inviteCodeOf(url);
  if (code) return useUI.getState().setJoinCode(code);
  const chat = chatLinkOf(url);
  if (chat) useChat.getState().openChatLink(chat).catch((e) => toast(e.message, 'error'));
  return undefined;
}

function useInviteLinks() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      // The web: a chat link's "Continue in the browser" lands here as /?chat=<who>&text=…
      const q = new URLSearchParams(window.location.search);
      if (q.get('chat')) {
        useChat.getState().openChatLink({ who: q.get('chat'), text: q.get('text') || '' }).catch((e) => toast(e.message, 'error'));
        window.history.replaceState(null, '', window.location.pathname);
      }
      return undefined;
    }
    const open = openAppLink;
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
  // Sessions from before linked devices register this device once.
  useEffect(() => {
    useAuth.getState().ensureDevice().catch(() => {});
  }, []);
  const activeId = useChat((s) => s.activeId);
  const infoOpen = useUI((s) => s.infoOpen);
  const lockedCall = useCall((s) => !!s.external?.locked);
  const e2eeFailed = useE2eeStatus().state === 'error';

  if (lockedCall) return <LockedCall />;
  // Messages are always end-to-end encrypted: no chats on a device where that can't work.
  // (It can still approve a sign-in on another device.)
  if (e2eeFailed) {
    return (
      <>
        <E2eeGate />
        <LoginRequestPrompt />
      </>
    );
  }

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
      <LoginRequestPrompt />
      <StatusViewer />
      <StatusComposer />
    </div>
  );
}

export default function App() {
  const token = useAuth((s) => s.token);
  // Signed up (or signed in) but the email isn't confirmed yet: only the code screen.
  const emailPending = useAuth((s) => s.user?.emailVerified === false);
  const syncChoice = useAuth((s) => s.syncChoice);
  useTheme();
  return (
    <>
      {!token ? <AuthScreen /> : emailPending ? <VerifyEmailScreen /> : syncChoice ? <SyncChoiceScreen /> : <Messenger token={token} />}
      <Toasts />
    </>
  );
}
