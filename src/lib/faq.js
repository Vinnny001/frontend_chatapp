// Help → frequently asked questions, by topic (what ChatApp actually does).
export const FAQ = [
  {
    topic: 'Account and signing in',
    items: [
      {
        q: 'Why does a new device ask me to approve the sign-in?',
        a: 'When your account is already signed in somewhere, a new phone or browser has to be approved from a device you have: open ChatApp there and tap the number shown on the new device, or scan its QR code. If you can’t, choose “Email me a code” on the new device.',
      },
      {
        q: 'I logged out but a device still shows as signed in',
        a: 'Open Settings → Linked devices on a device you still use and sign the other one out. ChatApp also retries a sign-out that didn’t reach the server the next time the app opens.',
      },
      {
        q: 'I forgot my password',
        a: 'On the sign-in screen choose “Forgot password?”. We email you a code; entering it lets you set a new password. Resetting the password signs out every other device.',
      },
      {
        q: 'How do I change my username, photo or about?',
        a: 'Settings → tap your photo or name. Your username is how people find you without your phone number.',
      },
    ],
  },
  {
    topic: 'Linked devices and sync',
    items: [
      {
        q: 'What does “Sync” mean on a new device?',
        a: 'Your other device sends the new one your recent chat history, your contacts and current status updates, all end-to-end encrypted. Choose “Don’t sync” to start fresh: you’ll only get messages from now on. You can change it later in Settings → Linked devices.',
      },
      {
        q: 'Why do some messages say “Sent before this device was linked”?',
        a: 'Encryption keys never leave a device. A device that joined later can’t read what was sent before it, unless it synced from another of your devices that still has those messages.',
      },
      {
        q: 'What does “Waiting for this message” mean?',
        a: 'The message was sent while you had no device signed in. It arrives as soon as the sender’s phone is online again, which re-sends it for your new device.',
      },
    ],
  },
  {
    topic: 'Encryption and security',
    items: [
      {
        q: 'Are my messages end-to-end encrypted?',
        a: 'Yes, always: messages, photos, videos, voice notes, polls, calls and status updates are encrypted on your device and only the devices of the people in the chat can read them. Not even ChatApp can.',
      },
      {
        q: 'Encryption couldn’t start on this device',
        a: 'ChatApp needs storage to keep your keys. Free up space (at least 100 MB), or, in a browser, clear the site’s data (the icon left of the address → Site settings → Delete data) and sign in again. Nothing can be sent until encryption works.',
      },
      {
        q: 'Someone I don’t know asked to sign in to my account',
        a: 'Tap “No, it wasn’t me” and change your password with “Forgot password?”. Whoever tried knows your password.',
      },
    ],
  },
  {
    topic: 'Messages and notifications',
    items: [
      {
        q: 'What do the ticks mean?',
        a: 'One tick: sent. Two grey ticks: delivered to their device. Two blue ticks: read. In a group, ticks turn blue when everyone has read it. Open “Message info” on your message to see exactly when.',
      },
      {
        q: 'Can I edit or delete a message?',
        a: 'Edit within 24 hours, and delete for everyone within 48 hours (group admins can delete any message). The other person’s notification and chat show the edit.',
      },
      {
        q: 'Can I reply from a notification?',
        a: 'Yes, on Android: type in the notification’s Reply box. Your reply is encrypted on your phone before it’s sent.',
      },
      {
        q: 'How do I mark a chat as unread?',
        a: 'Long-press (or right-click) the chat and choose “Mark as unread”. A chat also shows as unread again when a message you read is edited.',
      },
    ],
  },
  {
    topic: 'Groups',
    items: [
      {
        q: 'Who can change a group’s settings?',
        a: 'Admins choose, in Group info → Group settings, whether all members or only admins can edit the group’s info, send messages and add people, and whether new members need approval.',
      },
      {
        q: 'What is the group dashboard?',
        a: 'Admins can see how active a group is: messages per day and hour, and members’ activity. It only uses who sent messages and when, never what they say, and members can keep their own activity private in Settings.',
      },
    ],
  },
  {
    topic: 'Status',
    items: [
      {
        q: 'Who can see my status?',
        a: 'Choose in Status → Status privacy: your contacts, your contacts except some, or only some. Updates disappear after 24 hours and are end-to-end encrypted.',
      },
      {
        q: 'Can I see who viewed my status?',
        a: 'Yes: open your status and tap the views count at the bottom.',
      },
    ],
  },
  {
    topic: 'Calls',
    items: [
      {
        q: 'Are calls encrypted?',
        a: 'Yes. One-to-one calls are verified with both devices’ keys (you’ll see “End-to-end encrypted” on the call), and group calls use a key only the people in the call have.',
      },
    ],
  },
  {
    topic: 'Privacy and storage',
    items: [
      {
        q: 'Who sees my phone number and email?',
        a: 'With a username, your number stays private unless you allow it. Your email is only shown if you turn on “Share my email”. Both are in Settings → Privacy.',
      },
      {
        q: 'How do I free up space?',
        a: 'On a phone, open your phone’s storage settings and remove large files or apps you don’t use. ChatApp needs at least 100 MB free to keep your encryption keys and messages.',
      },
    ],
  },
];
