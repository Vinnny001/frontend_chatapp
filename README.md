# chat-frontend

App ID (Android package / iOS bundle): `com.jujatech.chatapp`.

ChatApp client for web, Android and iOS, built with React (JSX), Vite, Zustand, Socket.IO client and Capacitor.

It needs two backends running:
- **chat-api** (REST, default port 5050)
- **chat-realtime** (WebSocket, default port 5051)

## Web

```bash
npm install
cp .env.example .env     # VITE_API_URL, VITE_REALTIME_URL
npm run dev              # http://localhost:5173
npm run build            # production build in dist/
```

## Android

1. Point `.env` at an address the phone can reach:
   - Emulator: `http://10.0.2.2:5050` and `http://10.0.2.2:5051`
   - Real phone on the same Wi-Fi: your PC's LAN IP
2. Build and open Android Studio:
   ```bash
   npm run cap:android
   ```
3. Press ▶ Run in Android Studio.

The `android/` project is committed, and its microphone, camera and contacts permissions are already set. If Gradle complains about the Java version, set Android Studio's Gradle JDK to the bundled JDK 21.

## Offline, contacts and phone numbers

- **Offline history:** every message the app has seen is kept on the device (IndexedDB), together with downloaded photos, videos, voice notes, documents and profile pictures. Without a connection you can open any chat and scroll back through old messages and media. When stored media passes 1 GB, the files viewed least recently are removed first. Everything is erased from the device on sign-out.
- **Media auto-download (Settings):** like WhatsApp, you choose which media downloads automatically *on mobile data* and *on Wi-Fi*: Photos, Audio, Videos, Documents. The default is photos and audio on mobile data, everything on Wi-Fi. Media that isn't auto-downloaded shows a *Download · size* button, and documents download when opened. Settings also shows how much space downloaded media uses, with a *Clear downloaded media* button.
- **Save chat for offline (chat info):** downloads a chat's entire history and every photo, video, voice note and document in it, including old ones never opened on this device.
- **Sending offline:** text, photos, videos and voice notes written offline show a clock. They are kept on the device, even if the app is closed, and sent automatically when the connection returns. The server never stores the same message twice.
- **Sending with the app closed (Android and iOS):** queued messages, including photos, videos and voice notes, are handed to Android's WorkManager (`android/app/src/main/java/com/jujatech/chatapp/OutboxPlugin.java`, `OutboxWorker.java`). It uploads the file and sends the message as soon as the phone is online again, even if the app has been closed. Media files are copied into the app's private storage for this (`DeviceFilesPlugin.java`) and deleted once sent. When the app next opens, even offline, it shows those messages as sent and never uploads them twice. Android decides exactly when background work runs, typically within seconds to a couple of minutes of the network returning. On iOS the same happens through background upload transfers (`ios/App/App/OutboxPlugin.swift`): iOS completes them when the network returns, even if the app was suspended or closed by the system. The one exception is an app the user force-quits from the app switcher; iOS cancels its transfers, and those messages are sent the next time the app opens (WhatsApp has the same limitation).
- **Contacts:** right after sign-in the app asks for contacts access (read and write, the full Android permission), then shows under *New chat* which contacts are on ChatApp and lets you invite the rest by SMS. It re-syncs in the background at most every 12 hours. If a user denied access, *New chat → Find friends from contacts* asks again. On iOS 18+, users who grant only some contacts are told how to allow full access. On the web there is an *Invite a friend* share button instead. Set `VITE_INVITE_URL` to the link invites should contain.
- **Documents** (PDF, Word, Excel, …) are saved on the phone like other media. Tapping one opens it offline too, just like WhatsApp: in the phone's own viewer app on Android, and in Quick Look on iPhone (which also offers *Open in…* other apps). On the web it downloads or opens in a new tab.
- **Notifications (Android):** new messages arrive as pop-up (heads-up) notifications with sound through Firebase Cloud Messaging, including when the app is closed. The app asks for notification permission first, then contacts, one at a time. Tapping a notification opens that chat. The backends need `FIREBASE_SERVICE_ACCOUNT`, and the Android app needs `android/app/google-services.json` from the Firebase console (it isn't committed).
- **Phone numbers in messages** are tappable. They show *Message …* if the number is registered, otherwise *Invite to ChatApp*, plus *Call* and *Copy*.

## Sign-up and sign-in

- New accounts confirm their email with a 6-digit code (sent by email; "Send a new code" after a minute). Until then only the confirm screen is available.
- **Forgot password?** on the sign-in screen: enter your email, then the emailed code and a new password.

## Admin page

For accounts listed in the API's `ADMIN_EMAILS`: ⋮ menu → **Admin**. Overview (users, activity, messages, chats, open reports, storage, 14-day charts), Users (search, disable/enable, export CSV) and Reports (who, why, their last messages; dismiss, mark handled or disable the account).

## @mentions and pinned messages

- In a group, type **@** to pick a member (filter by name, @username or number; arrows/Enter or tap). They see it highlighted as **@You** and get a notification even if they muted the group; the chat list shows an **@** badge until they read it.
- **Pin** / **Unpin** in a message's menu (up to 3 per chat; a 4th replaces the oldest). The bar under the chat header shows the newest pin; tap it to jump there, and again for the next one. In "only admins can send" groups, only admins can pin.

## End-to-end encryption

Messages are end-to-end encrypted with **MLS** (RFC 9420, the `ts-mls` library, cipher suite P-256 / AES-128-GCM / SHA-256, which every Android WebView supports):
- Every signed-in device is a member of each of its chats' encryption groups. A message is encrypted **once** for the whole group however many devices there are (the key changes that add or remove devices grow with the logarithm of the group size).
- Keys move forward with every message and are deleted after use, so a stolen key can't read earlier messages. Each device refreshes its own keys at least daily, and signed-out devices and people who leave are removed before the next message is sent, so a stolen key stops working for later ones.
- Each device keeps its keys and the messages it decrypted in IndexedDB (`src/lib/e2ee`); they're deleted when you sign out on that device. A message can be decrypted only once, so the device's own copy is what you see from then on.
- A chat switches to encryption by itself once everyone in it has an up-to-date app, and stays encrypted. Older messages stay readable (not encrypted).
- **Your own devices** share a hidden encrypted channel (an MLS group of just your devices, `src/lib/e2ee/sync.js`):
  - **History**: a newly linked device asks once; another of your devices sends it what it decrypted in the last 90 days (texts, captions, polls, and attachment keys, so photos open too). View-once messages are never transferred. Encrypted messages can't be decrypted again by a new device on its own (their keys are deleted after use), so this is the only way old encrypted messages reach it.
  - **Contacts**: each phone shares the names it matched in its address book, whenever they change (read on start, on returning to the app and on opening New chat). Every device of yours shows those names; a computer, which has no address book, shows your phone's names. A device's own address book wins over names from another device.
- Notifications for encrypted messages say "🔒 New message". In encrypted chats, the notification's Reply opens the chat (only the app can encrypt).
- What's encrypted: text, captions, photos, videos, voice notes and files (each file is encrypted on the sender's device with its own AES-256-GCM key before upload; the key travels in the encrypted message), polls (question and options), view-once (the server hands out the encrypted file once; the viewer's device then deletes the key), forwarded flags, and what kind of message it is (the server sees every encrypted message as "text").
- Search, the Media/Links/Docs browser, reply quotes, pins and starred messages show encrypted messages from what this device decrypted. Reports include the reported person's last messages as your device decrypted them (marked as such for the admin).
- What the server still sees: who sends to whom and when, file sizes, whom a message @mentions (for the notification), which message a reply quotes, reactions (emoji), and poll votes as option numbers (not what the options say).
- **Calls**: one-to-one calls are encrypted between the two phones by WebRTC (DTLS-SRTP); each side signs its call setup (the DTLS fingerprints) with its device key and the other side checks it against the pinned key, so the server relaying the setup can't put itself in the middle. In encrypted chats an unverifiable call is ended; a verified one shows "🔒 End-to-end encrypted". **Group calls** use LiveKit's end-to-end encryption: the one who starts the call makes a random key and shares it with the group inside its MLS group, so LiveKit only forwards encrypted frames (a device that joined the group later gets the key re-shared by someone in the call). Each device has its own LiveKit identity, so two of your devices can be in the same call.
- Encrypted attachments can only be forwarded to encrypted chats; in an encrypted chat they're sent by the app itself (not the background sender, which can't encrypt files).

## Linked devices and sign-in approval

- Signing in on a new device while another one is signed in needs **approval**: the new device shows a number, and your signed-in devices ask "Edge on Windows wants to sign in" (a notification on phones, even with the app closed). Tap the matching number of three; a wrong number blocks the sign-in. Can't reach your other device? **Email me a code** on the waiting screen.
- Every new sign-in sends an email with the device, time and network address, and a **This wasn't me** link that signs that device out.
- **Settings → Privacy → Linked devices** lists every signed-in device; sign one out, or all others. A signed-out device drops to the sign-in screen at once. Resetting your password signs out every other device.
- Sessions from before linked devices register themselves automatically (shown as "Signed in before linked devices").

## Polls, view once, voice notes

- **Polls**: 📎 → **Poll**: a question, 2–12 options (a new row appears as you fill them), and "Allow multiple answers". Tap an option to vote, tap again to take it back; counts and bars update live for everyone. **View votes** shows who picked what.
- **View once**: in the photo/video preview, tap ① before sending (no caption). The recipient taps to open it full screen, once; it's never saved on the phone, can't be forwarded and never shows a thumbnail. Afterwards both sides see "Opened". The sender can't reopen it either. (Screenshots aren't blocked.)
- **Voice notes**: the 1× / 1.5× / 2× speed you pick is remembered for all voice notes, and when one ends the next voice note in the chat starts by itself.

## Group invite links

Group admins: group info → **Invite via link** to share, copy or reset the link (resetting stops the old one at once). The link is `https://<api>/join/<code>`, a small page served by the API with **Open in ChatApp**, which opens the app through `chatapp://join/<code>` (registered in `AndroidManifest.xml`). In the app, the link (tapped in a chat or opened from another app, even when the app was closed) shows the group's photo, name, description and member count, with **Join group**.

## Block and report

In a contact's info: **Block** / **Unblock** and **Report** (reason, details, "Also block"). A blocked chat shows "You blocked this contact. Tap to unblock." instead of the message box. **Settings → Privacy → Blocked contacts** lists them.

## Usernames, contacts and privacy

- **Reactions** work like WhatsApp: one per person (a new emoji replaces yours, the same one again removes it), shown instantly, sent even when the live connection is down. The author gets a notification ("Reacted 👍 to: …"), which is removed if the reaction is taken back. The chat list shows the latest reaction, and tapping the reactions under a message shows who reacted.
- **In-app alerts**: a message or reaction from another chat shows a banner at the top ("Grace reacted 🔥 to: …"); tap it to open the chat. Reaction notifications name who reacted, using the name you saved them under.
- **Calling someone**: you hear the phone's ringing tone while waiting, and a busy tone if they decline, are busy or don't answer.
- **Group calls** (voice and video, through LiveKit): the call buttons in a group ring every member, with the app closed or the phone locked too. Members join from the ringing screen or the **Join** button in the group while the call is on; declining only silences your phone. Everyone shows in a grid (video or photo, with a ring around whoever is talking), with mute, camera, switch camera and leave. The call is logged in the chat ("Group voice call · 5:12" / "Missed group voice call"). Group video is sent at 640×360 to save data.
- **Profile preview**: tapping a photo in the chat list shows the photo with the name and Chat / Call / Video / Info (Chat / Info for groups). Tap the photo to see it full size; on your own chat the preview has Edit profile.
- **Profile photos**: when adding one, drag and zoom to choose what shows (saved as a 640×640 square). Other people's profile photos are view-only (no download, no long-press save); you can download your own.
- **Last seen works both ways**: if you hide yours, you don't see anyone else's either (enforced by the server).
- **Message yourself**: at the top of New chat, by searching your own name or number, or by tapping your own number in a chat. You can't call yourself.
- **Media, links and docs**: a chat's info shows a few recent photos and a count; "View all" opens tabs for All, Media, Docs, Links, Apps and Favourites, with search. **Media hub** (⋮ menu on the chat list) does the same across all chats. Works offline from what's on the device.
- **Background sync**: after the chat list loads (on launch and every reconnect), chats are brought up to date on the device one at a time, including chats never opened (e.g. on a new phone), so they're readable offline later. It pauses while you send, open a chat or are on a call.
- **APK files** (Android apps) can be sent like documents, up to 50 MB. Tapping one opens the Android installer; the first time, Android asks to allow installs from ChatApp.

- Contacts sync by themselves: when the app starts, when it comes back to the foreground (if the last sync is over 10 minutes old) and when New chat opens.
- **Message yourself**: at the top of New chat, a private chat with just you for notes, links and files.
- Messages you were notified about are kept on the phone, so they're in the app even if it's opened offline. Long messages that don't fit in a notification show a preview until the full text loads.
- Chat history stays on the device. Reconnecting only fetches what's new, and scrolling back shows saved messages straight away.

- People appear under the name you saved them as (in the phone's address book, or in ChatApp), else their **@username**, else their **phone number**. Registered names stay private.
- Choose a username at sign-up (optional) or in Settings, where you also decide whether to **show your phone number** (only possible to hide with a username) and **share your email**. Both are off by default.
- In a chat's contact info you can **add the person to your ChatApp contacts** (with an optional name). If you can see their number (they have no username or chose to show it), you can also **save them to your phone contacts**; username-only people can't be saved to the phone.

## Notifications and calls (Android)

- Messages: one notification per chat, stacking its messages with each sender's photo, plus **Reply** and **Mark as read** buttons that work without opening the app (a reply written offline is sent once the phone is back online). A notification goes away when you read the chat, here or on another phone.
- Calls ring with the phone's own ringtone, following the ring / vibrate / silent setting, whether ChatApp is open, closed or the phone is locked, and pop up with **Answer** / **Decline**.
- On a locked phone a full-screen incoming-call screen appears without opening the app. Declining (or a missed call) leaves the phone on the lock screen; answering shows only the call over the lock screen, never the chats, and when the call ends the phone goes back to where it was. Missed calls show a "Missed call" notification, appear in the chat and in the **Calls** list (phone icon at the top of the chat list).
- The native parts are in `android/app/src/main/java/com/jujatech/chatapp/` (`ChatMessagingService`, `Notifier`, `NotificationActionReceiver`, `NativeSessionPlugin`).

## iOS (needs a Mac with Xcode)

The `ios/` project is committed with its native code already in place: `OutboxPlugin.swift` (background sending), `DeviceFilesPlugin.swift` (documents in Quick Look) and `MainViewController.swift` (plugin registration). The permission texts (contacts, microphone, camera, photos) are already in `Info.plist`. On a Mac:

```bash
npm install
npm run cap:ios           # builds, syncs and opens Xcode
```

In Xcode, choose your signing team (*Signing & Capabilities*) and press ▶ Run. Add `GoogleService-Info.plist` from Firebase once iOS push notifications are set up.

## Production

- On iOS there is no guaranteed background sending; messages written offline are sent when the app is next opened.
- Use `https://` and `wss://` backend URLs.
- Calls need a TURN server across mobile networks. Set it with `VITE_TURN_URL`, `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL`.
