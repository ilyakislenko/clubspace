// Expo config for the opt-in neutral "ClubSpace" build (EXPO_PUBLIC_CLUB_PICKER=
// true, eas profiles club-picker / club-picker-store). Every other build gets
// app.json untouched, so the default app identity does not change.
//
// The neutral build is named «ClubSpace», and — being the one app members of
// many clubs install — claims https://<web host>/join/* so a link or QR code
// opens it with the code filled in. Pure so it can be unit-tested.
function hostOf(url) {
  try {
    return url ? new URL(url).hostname : null
  } catch {
    return null
  }
}

function resolveAppVariant(config, env) {
  if (env.EXPO_PUBLIC_CLUB_PICKER !== "true") return config
  const host = hostOf(env.EXPO_PUBLIC_WEB_URL)
  return {
    ...config,
    name: "ClubSpace",
    ios: {
      ...config.ios,
      ...(host ? { associatedDomains: [`applinks:${host}`] } : {}),
    },
    android: {
      ...config.android,
      ...(host
        ? {
            intentFilters: [
              {
                action: "VIEW",
                autoVerify: true,
                data: [{ scheme: "https", host, pathPrefix: "/join/" }],
                category: ["BROWSABLE", "DEFAULT"],
              },
            ],
          }
        : {}),
    },
  }
}

module.exports = { resolveAppVariant }
