# chat-frontend

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

- **Offline:** the chat list, recent messages, drafts and unsent messages are saved on the device, so the app opens and works without a connection. Messages written offline show a clock and are sent automatically when the connection returns. The server never stores the same message twice.
- **Sending with the app closed (Android):** queued text messages are handed to Android's WorkManager (`android/.../OutboxPlugin.java`, `OutboxWorker.java`), which sends them as soon as the phone is online again, even if the app has been closed. Photos and voice notes still waiting to upload are sent the next time the app opens.
- **Contacts:** *New chat → Find friends from contacts* asks for permission, then shows which contacts are on ChatApp and lets you invite the rest by SMS. On the web there is an *Invite a friend* share button instead. Set `VITE_INVITE_URL` to the link invites should contain.
- **Phone numbers in messages** are tappable. They show *Message …* if the number is registered, otherwise *Invite to ChatApp*, plus *Call* and *Copy*.

## iOS (needs a Mac with Xcode)

```bash
npx cap add ios
npm run cap:ios
```

Add `NSMicrophoneUsageDescription`, `NSCameraUsageDescription` and `NSContactsUsageDescription` to `ios/App/App/Info.plist`, choose your signing team, then Run.

## Production

- On iOS there is no guaranteed background sending; messages written offline are sent when the app is next opened.
- Use `https://` and `wss://` backend URLs.
- Calls need a TURN server across mobile networks. Set it with `VITE_TURN_URL`, `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL`.
