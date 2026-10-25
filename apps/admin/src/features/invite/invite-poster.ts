import type { WorkspaceInvite } from "../../shared/api/invites"

export type InvitePosterParams = {
  workspaceName: string
  joinCodeDisplay: string
  joinUrl: string
  qrPngDataUrl: string
  appLinks: WorkspaceInvite["appLinks"]
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

// Only the stores that are configured, in a fixed order; the browser is
// always available.
const storesLine = (links: WorkspaceInvite["appLinks"]): string => {
  const names = [
    links.googlePlay ? "Google Play" : null,
    links.ruStore ? "RuStore" : null,
    links.web ? "в браузере" : null,
  ].filter((n): n is string => n !== null)
  return `Приложение ClubSpace — ${names.join(" · ")}`
}

// A full, self-contained A4 portrait document for the gym wall. Everything
// interpolated is escaped: the club name is user-entered.
export const buildInvitePosterHtml = (p: InvitePosterParams): string => `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escapeHtml(p.workspaceName)} — плакат</title>
<style>
  @page { size: A4 portrait; margin: 15mm; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #18171b; text-align: center; }
  h1 { font-size: 40px; margin: 20mm 0 4mm; }
  h2 { font-size: 30px; margin: 0 0 12mm; color: #5b58d9; }
  img { width: 12cm; height: 12cm; }
  .hint { font-size: 22px; margin: 8mm 0 3mm; }
  .url { font-size: 16px; word-break: break-all; margin: 0 0 8mm; }
  .code { font-size: 34px; font-weight: 700; font-family: monospace; letter-spacing: 4px; }
  .footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 14px; color: #605e68; }
</style>
</head>
<body>
<h1>Присоединяйтесь к клубу</h1>
<h2>${escapeHtml(p.workspaceName)}</h2>
<img src="${escapeHtml(p.qrPngDataUrl)}" alt="QR-код">
<p class="hint">Наведите камеру телефона на QR-код</p>
<p class="url">или откройте ${escapeHtml(p.joinUrl)}</p>
<p class="code">Код клуба: ${escapeHtml(p.joinCodeDisplay)}</p>
<p class="footer">${escapeHtml(storesLine(p.appLinks))}</p>
</body>
</html>`

// Opens the poster in a new tab and prints it once the QR has loaded.
// Returns false when the browser blocked the popup.
export const openInvitePoster = (p: InvitePosterParams): boolean => {
  const win = window.open("", "_blank")
  if (!win) return false
  win.document.write(buildInvitePosterHtml(p))
  win.document.close()
  const img = win.document.querySelector("img")
  const print = () => win.print()
  if (img && !img.complete) img.addEventListener("load", print)
  else print()
  return true
}
