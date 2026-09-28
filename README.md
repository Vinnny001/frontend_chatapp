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

The `android/` project is committed, and its microphone and camera permissions are already set. If Gradle complains about the Java version, set Android Studio's Gradle JDK to the bundled JDK 21.

## iOS (needs a Mac with Xcode)

```bash
npx cap add ios
npm run cap:ios
```

Add `NSMicrophoneUsageDescription` and `NSCameraUsageDescription` to `ios/App/App/Info.plist`, choose your signing team, then Run.

## Production

- Use `https://` and `wss://` backend URLs.
- Calls need a TURN server across mobile networks. Set it with `VITE_TURN_URL`, `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL`.
