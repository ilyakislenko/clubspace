// Mirrors the server's join-code alphabet and display format
// (apps/server/src/domains/workspace/join-code.ts): 8 characters from a
// 31-character alphabet without 0, O, 1, I and L, shown as XXXX-XXXX.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
const CODE_LENGTH = 8
const VALID = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`)

const strip = (raw: string): string =>
  raw.toUpperCase().replace(/[^A-Z0-9]/g, "")

/** What the input shows: uppercase, spaces and dashes ignored, XXXX-XXXX. */
export const formatJoinCodeInput = (raw: string): string => {
  const chars = strip(raw).slice(0, CODE_LENGTH)
  return chars.length > 4 ? `${chars.slice(0, 4)}-${chars.slice(4)}` : chars
}

export const JOIN_CODE_FORBIDDEN_HINT =
  "Проверьте код: в нём не бывает 0, O, 1, I и L"

/** The code to send, or why the typed one is not a code yet. */
export const joinCodeFromInput = (
  display: string,
): { code: string | null; error: string | null } => {
  const chars = strip(display)
  if (chars.length < CODE_LENGTH) return { code: null, error: null }
  const code = chars.slice(0, CODE_LENGTH)
  if (!VALID.test(code)) return { code: null, error: JOIN_CODE_FORBIDDEN_HINT }
  return { code, error: null }
}

const LINK = /\/join\/([A-Za-z0-9-]{1,32})(?=$|[/?#])/

/**
 * The code in `https://<app>/join/ABCD-2345` or `clubspace://join/ABCD2345`,
 * normalised; null when the URL is not a join link or the code is invalid.
 */
export const extractJoinCode = (url: string): string | null => {
  const match = LINK.exec(url)
  if (!match) return null
  const code = match[1].replace(/-/g, "").toUpperCase()
  return VALID.test(code) ? code : null
}

/** False when the join screen for this very code is already on top. */
export const shouldOpenJoin = (
  currentRoute: { name: string; params?: object } | undefined,
  code: string,
): boolean => {
  if (currentRoute?.name !== "JoinClub") return true
  const current = (currentRoute.params as { code?: string } | undefined)?.code
  return strip(current ?? "") !== code
}

// The app has no scanner: the phone's camera opens the club's link instead.
export const SCAN_QR_HINT = {
  link: "Как отсканировать QR-код?",
  title: "Как отсканировать QR-код",
  message:
    "Откройте камеру телефона и наведите её на QR-код клуба. Камера предложит открыть ссылку — приложение откроется с уже введённым кодом.",
}
