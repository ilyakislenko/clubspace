"use client"

import { CircleHelp } from "lucide-react"
import { usePathname } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import { environment } from "../../environments/environment"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { formatGuideDuration, loadGuides, type Guide } from "./guides-manifest"
import { helpEntryFor, type GuideId, type HelpEntry } from "./help-entries"

// The «?» of the shell header: what the open section is for, what can be done
// on it and the video guide that shows it. Only on pages with an entry; opens
// on a click only.
export function PageHelpButton() {
  const pathname = usePathname()
  const vocabulary = useVocabulary()
  const entry = useMemo(() => helpEntryFor(pathname, vocabulary), [pathname, vocabulary])
  const [open, setOpen] = useState(false)
  if (!entry) return null
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Как работает этот раздел"
        onClick={() => setOpen(true)}
      >
        <CircleHelp />
      </Button>
      <PageHelpSheet
        entry={entry}
        open={open}
        onOpenChange={setOpen}
        guidesBaseUrl={environment.guidesBaseUrl}
        allGuidesUrl={environment.publicAppUrl ? `${environment.publicAppUrl}/help` : null}
      />
    </>
  )
}

export function PageHelpSheet({
  entry,
  open,
  onOpenChange,
  guidesBaseUrl,
  allGuidesUrl,
}: {
  entry: HelpEntry
  open: boolean
  onOpenChange: (open: boolean) => void
  guidesBaseUrl: string | null
  allGuidesUrl: string | null
}) {
  // null until the manifest is read; it stays null when it can't be.
  const [guides, setGuides] = useState<Map<GuideId, Guide> | null>(null)
  const wantsGuides = open && !!guidesBaseUrl && !!entry.guides?.length && guides === null

  useEffect(() => {
    if (!wantsGuides || !guidesBaseUrl) return
    let alive = true
    loadGuides(guidesBaseUrl)
      .then((loaded) => alive && setGuides(loaded))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [wantsGuides, guidesBaseUrl])

  const videos = (entry.guides ?? []).flatMap((id) => {
    const guide = guides?.get(id)
    return guide ? [guide] : []
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-6 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Как работает раздел «{entry.title}»</SheetTitle>
          <SheetDescription>{entry.purpose}</SheetDescription>
        </SheetHeader>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Что здесь можно сделать</h3>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {entry.actions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </section>

        {videos.map((guide) => (
          <figure key={guide.id} className="space-y-2">
            <video
              controls
              preload="metadata"
              poster={guide.posterUrl ?? undefined}
              src={guide.videoUrl}
              className="aspect-video w-full rounded-md bg-muted"
            />
            <figcaption className="flex items-baseline justify-between gap-3 text-sm">
              <span>{guide.title}</span>
              {guide.durationSec !== null && (
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatGuideDuration(guide.durationSec)}
                </span>
              )}
            </figcaption>
          </figure>
        ))}

        {allGuidesUrl && (
          <a
            href={allGuidesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-auto text-sm font-medium underline underline-offset-4"
          >
            Все видеоинструкции
          </a>
        )}
      </SheetContent>
    </Sheet>
  )
}
