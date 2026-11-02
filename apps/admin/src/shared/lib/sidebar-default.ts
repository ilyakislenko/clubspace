// The workspace sidebar is 256px wide. Below a laptop width it eats a quarter
// of a 1024px tablet, and every `lg:` grid then lays out for a window it no
// longer has — so there it starts collapsed to the icon strip. An explicit
// choice (the ui-kit `SidebarProvider` writes it to this cookie on every
// toggle) always wins over the width.

export const SIDEBAR_STATE_COOKIE = "sidebar_state"

// Windows at least this wide start with the sidebar expanded.
export const SIDEBAR_EXPANDED_MIN_WIDTH = 1280

// The saved open/closed choice from a `document.cookie` string, or null when
// the user has never toggled the sidebar (or the value is unreadable).
export function readSidebarCookie(cookie: string): boolean | null {
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== SIDEBAR_STATE_COOKIE) continue
    const value = part.slice(eq + 1).trim()
    if (value === "true") return true
    if (value === "false") return false
    return null
  }
  return null
}

export function defaultSidebarOpen(cookie: string, windowWidth: number): boolean {
  return readSidebarCookie(cookie) ?? windowWidth >= SIDEBAR_EXPANDED_MIN_WIDTH
}
