// A lapsed session sends the visitor to /sign-in with the page they were on
// (?next=), and a successful sign-in returns there — so /sign-up opened with
// a stale session comes back to the club form, not to «Выберите клуб».

export const DEFAULT_AFTER_SIGN_IN = "/workspaces"

/** /sign-in remembering `path` (pathname + search); none from /sign-in itself. */
export const signInHref = (path: string): string =>
  path === "/" || path.startsWith("/sign-in")
    ? "/sign-in"
    : `/sign-in?next=${encodeURIComponent(path)}`

/**
 * Where to go after signing in: `next` when it is a path of this app — never
 * another origin (`//host`, `/\host`, `https:`), never back to /sign-in.
 */
export const afterSignInPath = (next: string | null): string =>
  next &&
  next.startsWith("/") &&
  !next.startsWith("//") &&
  !next.startsWith("/\\") &&
  !next.startsWith("/sign-in")
    ? next
    : DEFAULT_AFTER_SIGN_IN
