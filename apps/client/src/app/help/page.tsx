import type { Metadata } from "next"
import Link from "next/link"

import {
  formatGuideDuration,
  groupGuidesByRole,
  parseGuidesManifest,
  readGuidesBaseUrl,
  type GuideGroup,
} from "../../shared/lib/guides"

// GUIDES_BASE_URL and its manifest are read at request time: publishing a new
// guide is an upload, not a deploy (docs/guides.md).
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Видеоинструкции",
  description: "Короткие видео: как вести клуб в ClubSpace",
  alternates: { canonical: "/help" },
}

// The published guides, or null when none can be shown: no GUIDES_BASE_URL,
// the manifest unreachable or not JSON. The page then says so instead of
// failing.
async function loadGuides(): Promise<GuideGroup[] | null> {
  const base = readGuidesBaseUrl()
  if (!base) return null
  try {
    const res = await fetch(`${base}/guides.json`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const groups = groupGuidesByRole(parseGuidesManifest(await res.json(), base))
    return groups.length > 0 ? groups : null
  } catch {
    return null
  }
}

export default async function HelpPage() {
  const groups = await loadGuides()

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <h1 className="text-3xl font-semibold">Видеоинструкции</h1>

      {!groups ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Видеоинструкции пока не опубликованы. Загляните позже.
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.role} className="space-y-4">
            <h2 className="text-xl font-semibold">{group.role}</h2>
            {group.guides.map((g) => (
              <article
                key={g.id}
                className="space-y-3 rounded-xl border border-border bg-card p-4"
              >
                <video
                  controls
                  preload="metadata"
                  poster={g.poster ?? undefined}
                  src={g.file}
                  className="aspect-video w-full rounded-lg bg-black"
                />
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="font-semibold">{g.title}</h3>
                  {g.durationSec !== null && (
                    <span className="shrink-0 text-sm text-muted-foreground">
                      {formatGuideDuration(g.durationSec)}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </section>
        ))
      )}

      <footer className="border-t border-border pt-4 text-center text-xs text-muted-foreground">
        <Link href="/" className="hover:underline">
          ClubSpace
        </Link>{" "}
        ·{" "}
        <Link href="/download" className="hover:underline">
          Скачать приложение
        </Link>{" "}
        ·{" "}
        <Link href="/legal/privacy" className="hover:underline">
          Конфиденциальность
        </Link>
      </footer>
    </main>
  )
}
