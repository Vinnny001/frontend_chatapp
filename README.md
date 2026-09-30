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

## Usernames, contacts and privacy

- People appear under the name you saved them as (in the phone's address book, or in ChatApp), else their **@username**, else their **phone number**. Registered names stay private.
- Choose a username at sign-up (optional) or in Settings, where you also decide whether to **show your phone number** (only possible to hide with a username) and **share your email**. Both are off by default.
- In a chat's contact info you can **add the person to your ChatApp contacts** (with an optional name). If you can see their number (they have no username or chose to show it), you can also **save them to your phone contacts**; username-only people can't be saved to the phone.

## Notifications and calls (Android)

- Messages: one notification per chat, stacking its messages with each sender's photo, plus **Reply** and **Mark as read** buttons that work without opening the app (a reply written offline is sent once the phone is back online). A notification goes away when you read the chat, here or on another phone.
- Calls ring with the phone's ringtone (or vibrate, following the ringer switch) even when the app is closed, and pop up with **Answer** / **Decline**; over the lock screen they open the call screen. Missed calls show a "Missed call" notification, appear in the chat and in the **Calls** list (phone icon at the top of the chat list).
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
