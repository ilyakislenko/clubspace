import { shouldSendActAs } from "./act-as"

describe("shouldSendActAs", () => {
  it.each([
    ["get", "/workspaces/ws-1/me/subscription"],
    ["post", "/workspaces/ws-1/attendance/check-in"],
    ["post", "/workspaces/ws-1/me/subscription/freeze-requests"],
    ["get", "/workspaces/ws-1"],
    ["delete", "/workspaces/ws-1/drop-ins/b-1"],
    ["get", "/me"],
    ["post", "/get-my-workspaces"],
    ["post", "/workspaces/join"],
    ["get", "/me/join-requests"],
    ["get", "/me/agenda"],
    ["get", "/me/agenda?from=2026-11-01&to=2026-11-07"],
    ["get", "/me/export"],
    ["get", "/videos/v-1/playback"],
    ["get", "/videos/v-1/web-playback"],
    ["post", "/videos/v-1/progress"],
    ["put", "/videos/v-1/favorite"],
  ])("sends it on %s %s", (method, url) => {
    expect(shouldSendActAs(method, url)).toBe(true)
  })

  it.each([
    // The guardian's own account: profile edits, deletion, sessions.
    ["patch", "/me"],
    ["delete", "/me"],
    ["post", "/me/sign-out-everywhere"],
    // Push, inbox and notification settings always belong to the guardian.
    ["post", "/me/firebase-devices"],
    ["delete", "/me/firebase-devices"],
    ["get", "/me/notifications"],
    ["post", "/me/notifications/seen"],
    ["get", "/me/notification-preferences"],
    ["patch", "/me/notification-preferences"],
    // Invitations, consent and a membership's mute / leave are the guardian's.
    ["get", "/me/invitations"],
    ["post", "/me/invitations/i-1/accept"],
    ["post", "/me/invitations/i-1/decline"],
    ["get", "/me/consent"],
    ["post", "/me/consent"],
    ["delete", "/me/memberships/ws-1"],
    ["put", "/me/memberships/ws-1/notifications"],
    // Offline downloads are never offered in a child's profile.
    ["get", "/videos/v-1/offline-manifest"],
    // Managing children is the guardian's job.
    ["get", "/me/dependents"],
    ["post", "/me/dependents"],
    ["post", "/me/dependents/d-1/confirm"],
    ["delete", "/me/dependents/d-1"],
    ["delete", "/me/dependents/d-1/guardianship"],
    // Auth.
    ["post", "/refresh-token"],
    ["post", "/sign-in"],
    // Allowlisted paths with the wrong verb.
    ["get", "/videos/v-1/favorite"],
    ["get", "/videos/v-1/progress"],
    ["post", "/me"],
    ["get", "/get-my-workspaces"],
    // Look-alikes.
    ["get", "/videos/v-1/playback/extra"],
    ["post", "/videos/v-1/web-playback"],
    ["get", "/workspaces"],
    ["get", "/me/join-requests/x"],
  ])("never sends it on %s %s", (method, url) => {
    expect(shouldSendActAs(method, url)).toBe(false)
  })

  it("ignores the query string, fragment, origin and a trailing slash", () => {
    expect(shouldSendActAs("get", "/me?fields=all")).toBe(true)
    expect(shouldSendActAs("get", "/me/#x")).toBe(true)
    expect(shouldSendActAs("GET", "https://api.example.com/me")).toBe(true)
    expect(
      shouldSendActAs("delete", "https://api.example.com/me?x=1"),
    ).toBe(false)
  })

  it("defaults a missing method to GET and never sends without a url", () => {
    expect(shouldSendActAs(undefined, "/me")).toBe(true)
    expect(shouldSendActAs("get", undefined)).toBe(false)
    expect(shouldSendActAs("get", "")).toBe(false)
  })
})
