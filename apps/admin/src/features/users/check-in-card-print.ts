export type CheckInCardPrintParams = {
  name: string
  qrPngDataUrl: string
  // «Покажите эту карту тренеру у входа», in the club's words.
  hint: string
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

// A self-contained page with one cut-out card (the club poster's pattern,
// invite-poster.ts): the QR big enough for a phone camera at arm's length,
// the name the coach checks against the child. Everything interpolated is
// escaped: the name is user-entered.
export const buildCheckInCardHtml = (p: CheckInCardPrintParams): string => `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escapeHtml(p.name)} — карта для входа</title>
<style>
  @page { size: A4 portrait; margin: 15mm; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #18171b; }
  .card { width: 80mm; padding: 6mm; border: 1px dashed #8a8892; border-radius: 4mm; text-align: center; }
  img { width: 60mm; height: 60mm; }
  .name { font-size: 18px; font-weight: 700; margin: 3mm 0 1mm; }
  .hint { font-size: 12px; color: #605e68; margin: 0; }
</style>
</head>
<body>
<div class="card">
<img src="${escapeHtml(p.qrPngDataUrl)}" alt="QR-код">
<p class="name">${escapeHtml(p.name)}</p>
<p class="hint">${escapeHtml(p.hint)}</p>
</div>
</body>
</html>`

// Opens the card in a new tab and prints it once the QR has loaded.
// Returns false when the browser blocked the popup.
export const openCheckInCardPrint = (p: CheckInCardPrintParams): boolean => {
  const win = window.open("", "_blank")
  if (!win) return false
  win.document.write(buildCheckInCardHtml(p))
  win.document.close()
  const img = win.document.querySelector("img")
  const print = () => win.print()
  if (img && !img.complete) img.addEventListener("load", print)
  else print()
  return true
}
