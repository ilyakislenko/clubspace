// A lapsed session sends the visitor to /sign-in with the page they were on
// (?next=), and a successful sign-in returns there — so /sign-up opened with
// a stale session comes back to the club form, not to «Выберите клуб».

export const DEFAULT_AFTER_SIGN_IN = "/workspaces"

/** /sign-in remembering `path` (pathname + search); none from /sign-in itself. */
export const signInHref = (path: string): string =>
  path === "/" || path.startsWith("/sign-in")
    ? "/sign-in"
    : `/sign-in?next=${encodeURIComponent(path)}`

// Any fixed origin: `next` is resolved against it the way the browser resolves
// it against ours, so whatever lands elsewhere is foreign.
const SELF = "https://admin.invalid"

/**
 * Where to go after signing in: `next` when it is a path of this app — never
 * another origin, never back to /sign-in. Parsed as a URL rather than matched
 * by prefix: the parser drops TAB/CR/LF and reads `\` as `/`, so `/\t/evil`
 * or `/\\evil` would pass a prefix check and still leave for `//evil`.
 */
export const afterSignInPath = (next: string | null): string => {
  if (!next) return DEFAULT_AFTER_SIGN_IN
  let url: URL
  try {
    url = new URL(next, SELF)
  } catch {
    return DEFAULT_AFTER_SIGN_IN
  }
  const path = url.pathname + url.search + url.hash
  // The normalised path must not read as another host either: `/a/..//evil`
  // resolves to the path `//evil`.
  return url.origin === SELF &&
    !path.startsWith("//") &&
    !url.pathname.startsWith("/sign-in")
    ? path
    : DEFAULT_AFTER_SIGN_IN
}
