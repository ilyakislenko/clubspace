import {
  androidInstall,
  appJoinUrl,
  pwaJoinUrl,
  type StoreButton,
  type StoreLinks,
} from "../../shared/lib/app-links"

const primary =
  "flex h-12 w-full items-center justify-center rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90"
const secondary =
  "flex h-11 items-center justify-center rounded-full border border-border bg-card px-5 text-sm font-medium transition-colors hover:bg-muted"

// The join flow for one code: open it in the installed app; no app yet —
// a store (on Android the APK when the app is in none), or the web app; or
// type the code by hand.
export function JoinActions({
  code,
  codeDisplay,
  links,
}: {
  code: string
  codeDisplay: string
  links: StoreLinks
}) {
  // Android's web-app fallback is «Открыть в браузере» below; the APK is a
  // download, so it opens in this tab, unlike the stores.
  const android = androidInstall(links)
  const stores: StoreButton[] = [
    ...(links.appStore ? [{ href: links.appStore, label: "App Store" }] : []),
    ...(android?.kind === "stores" ? android.stores : []),
  ]
  const apk = android?.kind === "apk" ? android.href : null
  const browser = pwaJoinUrl(links, code)

  return (
    <div className="space-y-6">
      <a href={appJoinUrl(code)} className={primary}>
        Открыть в приложении
      </a>

      {(stores.length > 0 || apk || browser) && (
        <div className="space-y-2">
          <p className="text-center text-sm text-muted-foreground">
            Ещё нет приложения ClubSpace?
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {stores.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className={secondary}
              >
                {s.label}
              </a>
            ))}
            {apk && (
              <a href={apk} className={secondary}>
                Скачать для Android
              </a>
            )}
            {browser && (
              <a href={browser} className={secondary}>
                Открыть в браузере
              </a>
            )}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-dashed border-border p-5 text-center">
        <p className="text-sm text-muted-foreground">
          Или введите код клуба в приложении вручную
        </p>
        <p
          className="mt-2 select-all font-mono text-4xl font-semibold tracking-[0.2em]"
          aria-label={`Код клуба ${codeDisplay}`}
        >
          {codeDisplay}
        </p>
      </div>
    </div>
  )
}
