# ClubSpace mobile

Expo app (iOS, Android, PWA). One codebase, two ways to ship it. In both a member
can join a club by code, by link, or by QR code.

## Build modes

### 1. Club-branded build (default)

The club is baked into the binary with `EXPO_PUBLIC_WORKSPACE_KEY` (or the
brand's default key). Sign-in attaches a new student to that club as a pending
request for the trainer to approve. Profiles: `preview`, `production`, `store`.

- The app identity (name, slug, `com.clubspace.app`, icon) comes from `app.json`.
- A member who has no club sees the state of the request: waiting for approval,
  rejected (contact the club), or not found (the key matched no club).
- A member can still tap «Ввести код клуба» there, or «Добавить клуб» in
  Профиль → Клубы, to join another club by code.

### 2. Neutral «ClubSpace» build (opt-in club picker)

No club is baked in: `EXPO_PUBLIC_CLUB_PICKER=true`. The member signs in, then
enters the club code (or opens the club's link or QR code). Profiles:
`club-picker` (APK) and `club-picker-store` (AAB). They extend `production`, so
set `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_URL` and `EXPO_PUBLIC_SUPPORT_EMAIL`
there (`scripts/set-mobile-target.sh` fills `production`).

```
eas build --profile club-picker
```

`app.config.js` (see `src/app-variant.js`) layers only this on top of `app.json`
when the switch is on: the app is named «ClubSpace», and on Android/iOS it claims
`https://<EXPO_PUBLIC_WEB_URL host>/join/*` (App Links / universal links). The
default build is never changed by it. Android App Links need the host's
`assetlinks.json`; until verified, links open the PWA, which also joins.

Caveats of the club-picker build: it keeps the applicationId `com.clubspace.app`,
so it cannot be installed next to the club-branded build, and uploading
`club-picker-store` to the existing Play listing would replace the club-branded
app for its users. Splash and sign-in still use the grappling brand (a neutral
brand preset is a follow-up).

The release check (`scripts/check-release-env.mjs`) does not require a club key
for these profiles.

## Joining a club

- Code: 8 characters, shown `XXXX-XXXX`, without 0, O, 1, I, L. Typing ignores
  case, spaces and dashes.
- Link: `https://<web host>/join/<code>` or `clubspace://join/<code>`. A link
  opened while signed out is remembered and used after sign-in.
- QR code: scan it with the phone's camera app, which opens the link. There is
  no scanner in the app.
- Result: the club accepts at once (opens in the app), or the request waits for
  an administrator (an e-mail and a notification arrive on approval), or the club
  rejected it.

## Commands

- Typecheck: `npx tsc -p apps/mobile/tsconfig.app.json --noEmit` (the plain
  `tsconfig.json` reports clean when it is not).
- Tests: `NX_DAEMON=false npx nx test @clubspace/mobile`
- PWA: `npm run build:pwa`
