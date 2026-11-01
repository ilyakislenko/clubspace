// While a guardian acts for a child, requests that the server lets a child
// make carry `X-Act-As: <childId>`. The server refuses the header on any other
// route («В профиле ребёнка это действие недоступно»), and some of those routes
// must stay the guardian's anyway (push registration, the inbox, sign-out,
// account deletion) — so the client sends it only on this allowlist.
export const ACT_AS_HEADER = "X-Act-As"

type Rule = { method: string; path: RegExp }

const SEGMENT = "[^/]+"

const USER_LEVEL_RULES: readonly Rule[] = [
  { method: "get", path: /^\/me$/ },
  { method: "post", path: /^\/get-my-workspaces$/ },
  { method: "post", path: /^\/workspaces\/join$/ },
  { method: "get", path: /^\/me\/join-requests$/ },
  // The child's week across their clubs.
  { method: "get", path: /^\/me\/agenda$/ },
  // The child's data export.
  { method: "get", path: /^\/me\/export$/ },
  { method: "get", path: new RegExp(`^/videos/${SEGMENT}/playback$`) },
  // The web build's player.
  { method: "get", path: new RegExp(`^/videos/${SEGMENT}/web-playback$`) },
  { method: "post", path: new RegExp(`^/videos/${SEGMENT}/progress$`) },
  { method: "put", path: new RegExp(`^/videos/${SEGMENT}/favorite$`) },
]

// A club's routes: /workspaces/<id> and everything under it. The server still
// refuses staff-only ones; the child UI doesn't offer them.
const WORKSPACE_ROUTE = new RegExp(`^/workspaces/${SEGMENT}(/.*)?$`)

// The path alone: no origin, query or fragment, no trailing slash.
const pathOf = (url: string): string => {
  const noOrigin = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "")
  const path = noOrigin.split(/[?#]/)[0] ?? ""
  const withSlash = path.startsWith("/") ? path : `/${path}`
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash
}

export const shouldSendActAs = (
  method: string | undefined,
  url: string | undefined,
): boolean => {
  if (!url) return false
  const verb = (method ?? "get").toLowerCase()
  const path = pathOf(url)
  if (WORKSPACE_ROUTE.test(path)) return true
  return USER_LEVEL_RULES.some(
    (rule) => rule.method === verb && rule.path.test(path),
  )
}
