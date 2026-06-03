# Digital Tree of Wishes

A full-stack real-time React app with a mobile submission page and a fullscreen SVG tree display. Names submitted from phones are stored in Firebase Realtime Database and appear instantly as animated leaves on the display.

## Setup

1. Create a Firebase project and enable Realtime Database.
2. Copy `.env.example` to `.env`.
3. Fill in your Firebase web app config values.
4. Install and run:

```bash
npm install
npm run dev
```

## Routes

- `/` or `/submit` - mobile submission page for the QR code.
- `/display` - fullscreen tree screen for TV/LED display.

## Realtime Database

Path: `/leaves`

Each child:

```json
{
  "name": "string",
  "createdAt": "timestamp",
  "x": 320,
  "y": 240,
  "color": "#7fbf3f"
}
```

For public events, secure this collection with rules appropriate to your venue, rate limiting approach, and moderation needs.
