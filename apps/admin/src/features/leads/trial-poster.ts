import { agree, cap, type SessionNoun } from "@clubspace/ui-kit/brand"

import { getTrialLink, type TrialLink } from "../../shared/api/leads"
import { errorMessage } from "../../shared/lib/error-message"
import { escapeHtml, openPrintablePoster } from "../invite/invite-poster"

export type TrialPosterParams = {
  workspaceName: string
  // trialHeading(): «Пробное занятие» in the club's words.
  heading: string
  // The public form, `?src=qr` included (TrialLinkOutput.url).
  url: string
  qrPngDataUrl: string
}

// Why the public form does not take requests (TrialLinkOutput.missing).
export const TRIAL_FORM_OFF: Record<NonNullable<TrialLink["missing"]>, string> = {
  disabled: "Форма на странице клуба выключена",
  operator: "Форма на странице клуба выключена: не указан оператор персональных данных",
  slug: "Форма на странице клуба не работает: у клуба нет адреса страницы",
}

// «Пробное занятие» / «Пробная тренировка», in the club's words.
export const trialHeading = (session: SessionNoun): string =>
  `${cap(agree(session, "пробная", "пробное"))} ${session.nom}`

// A self-contained A4 portrait poster for the gym door or a flyer: the club,
// the QR to the trial form and its address. Everything interpolated is
// escaped: the club name is user-entered.
export const buildTrialPosterHtml = (p: TrialPosterParams): string => `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escapeHtml(p.workspaceName)} — ${escapeHtml(p.heading.toLowerCase())}</title>
<style>
  @page { size: A4 portrait; margin: 15mm; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #18171b; text-align: center; }
  h1 { font-size: 44px; margin: 20mm 0 4mm; }
  h2 { font-size: 30px; margin: 0 0 12mm; color: #5b58d9; }
  img { width: 12cm; height: 12cm; }
  .hint { font-size: 24px; margin: 8mm 0 3mm; }
  .url { font-size: 16px; word-break: break-all; margin: 0; }
</style>
</head>
<body>
<h1>${escapeHtml(p.heading)}</h1>
<h2>${escapeHtml(p.workspaceName)}</h2>
<img src="${escapeHtml(p.qrPngDataUrl)}" alt="QR-код">
<p class="hint">Наведите камеру — оставьте заявку</p>
<p class="url">или откройте ${escapeHtml(p.url)}</p>
</body>
</html>`

// «QR-плакат для записи на пробное»: asks the server for the current link and
// prints the poster. Returns what to tell the person when it can't — what to
// fill in (the club admin) or who can (anyone else) — or null once printed.
export const printTrialPoster = async (p: {
  workspaceId: string
  workspaceName: string
  session: SessionNoun
  canAdmin: boolean
}): Promise<string | null> => {
  let link: TrialLink
  try {
    link = await getTrialLink({ workspaceId: p.workspaceId })
  } catch (e) {
    return errorMessage(e, "Не удалось подготовить плакат")
  }
  if (link.missing) {
    return p.canAdmin
      ? `${TRIAL_FORM_OFF[link.missing]} — Настройки → Профиль клуба`
      : "Форму на странице клуба включает администратор клуба"
  }
  if (!link.url || !link.qrPngDataUrl) {
    return "Публичный адрес приложения не настроен — плакат появится, когда администратор платформы задаст APP_URL"
  }
  const opened = openPrintablePoster(
    buildTrialPosterHtml({
      workspaceName: p.workspaceName,
      heading: trialHeading(p.session),
      url: link.url,
      qrPngDataUrl: link.qrPngDataUrl,
    }),
  )
  return opened ? null : "Браузер заблокировал новое окно — разрешите всплывающие окна для этого сайта"
}
