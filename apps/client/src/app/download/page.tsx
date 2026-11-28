import type { Metadata } from "next"
import Link from "next/link"
import { toString as qrSvg } from "qrcode"

import {
  androidInstall,
  iosInstall,
  readSiteLinks,
  readStoreLinks,
} from "../../shared/lib/app-links"

// Store, APK and web-app links come from the container's environment at
// request time, like the join pages'.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Скачать приложение",
  description: "Приложение ClubSpace для Android и iPhone",
  alternates: { canonical: "/download" },
}

const primary =
  "flex h-12 w-full items-center justify-center rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:w-fit"
const secondary =
  "flex h-12 w-full items-center justify-center rounded-full border border-border px-6 text-base font-semibold transition-colors hover:bg-muted sm:w-fit"
const card = "space-y-4 rounded-xl border border-border bg-card p-5"

// This page's own address as a QR code, for opening it on a phone from a
// computer screen. An SVG data URL (img-src allows data:).
async function pageQr(site: string | null): Promise<string | null> {
  if (!site) return null
  const svg = await qrSvg(`${site}/download`, { type: "svg", margin: 1 })
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// The web app's address as people type it; the raw value if it is no URL.
const hostOf = (href: string): string => {
  try {
    return new URL(href).host
  } catch {
    return href
  }
}

// Adding the web app to the home screen: open it in the browser, then two
// taps there. A link inside the steps, not a button — on a page where both
// platforms fall back to the web app it would be the same button twice.
function PwaSteps({
  href,
  browser,
  steps,
}: {
  href: string
  browser: string
  steps: [string, string]
}) {
  return (
    <ol className="list-decimal space-y-2 pl-5 text-sm leading-6">
      <li>
        Откройте{" "}
        <a
          href={href}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {hostOf(href)}
        </a>{" "}
        в {browser}.
      </li>
      {steps.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  )
}

// One way to install the app per platform, from what the instance has
// configured: the stores, else the APK (Android), else the web app on the
// home screen.
export default async function DownloadPage() {
  const links = readStoreLinks()
  const android = androidInstall(links)
  const ios = iosInstall(links)
  const qr = android || ios ? await pageQr(readSiteLinks().site) : null

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <h1 className="text-3xl font-semibold">Скачать приложение</h1>

      {!android && !ios ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Ссылки на приложение пока не добавлены. Спросите в своём клубе, как
          его установить.
        </p>
      ) : (
        <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-start">
          <div className="space-y-6">
            {android && (
              <section className={card}>
                <h2 className="text-lg font-semibold">Android</h2>
                {android.kind === "stores" ? (
                  <div className="flex flex-col gap-3 sm:flex-row">
                    {android.stores.map((s, i) => (
                      <a
                        key={s.label}
                        href={s.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={i === 0 ? primary : secondary}
                      >
                        {s.label}
                      </a>
                    ))}
                  </div>
                ) : android.kind === "apk" ? (
                  <>
                    <a href={android.href} className={primary}>
                      Скачать для Android
                    </a>
                    <p className="text-sm text-muted-foreground">
                      Android попросит разрешить установку из этого
                      источника — разрешите и продолжите.
                    </p>
                  </>
                ) : (
                  <PwaSteps
                    href={android.href}
                    browser="Chrome"
                    steps={[
                      "Откройте меню ⋮.",
                      "Выберите «Установить приложение» или «Добавить на главный экран».",
                    ]}
                  />
                )}
              </section>
            )}

            {ios && (
              <section className={card}>
                <h2 className="text-lg font-semibold">iPhone и iPad</h2>
                {ios.kind === "store" ? (
                  <a
                    href={ios.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={primary}
                  >
                    App Store
                  </a>
                ) : (
                  <PwaSteps
                    href={ios.href}
                    browser="Safari"
                    steps={["Нажмите «Поделиться».", "Выберите «На экран „Домой“»."]}
                  />
                )}
              </section>
            )}
          </div>

          {qr && (
            <figure className="hidden w-48 space-y-2 md:block">
              <img
                src={qr}
                alt="QR-код этой страницы"
                width={192}
                height={192}
                className="rounded-xl border border-border bg-white p-2"
              />
              <figcaption className="text-center text-xs text-muted-foreground">
                Наведите камеру телефона, чтобы открыть эту страницу на нём
              </figcaption>
            </figure>
          )}
        </div>
      )}

      <footer className="border-t border-border pt-4 text-center text-xs text-muted-foreground">
        <Link href="/" className="hover:underline">
          ClubSpace
        </Link>{" "}
        ·{" "}
        <Link href="/legal/privacy" className="hover:underline">
          Конфиденциальность
        </Link>
      </footer>
    </main>
  )
}
