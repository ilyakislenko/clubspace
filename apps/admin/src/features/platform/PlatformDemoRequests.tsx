"use client"

import { useEffect, useState } from "react"

import {
  fetchPlatformDemoRequests,
  type PlatformDemoRequest,
} from "../../shared/api/platform"
import { errorMessage } from "../../shared/lib/error-message"
import { formatShortDate } from "../billing/billing-view"

const PREVIEW = 5

// A Telegram handle opens the chat, a phone number dials; anything else is
// shown as typed.
export const contactHref = (contact: string): string | null => {
  const value = contact.trim()
  const handle = value.match(/^(?:@|https?:\/\/t\.me\/|t\.me\/)([A-Za-z0-9_]{4,32})$/)
  if (handle) return `https://t.me/${handle[1]}`
  const digits = value.replace(/[\s()+-]/g, "")
  if (/^\d{6,15}$/.test(digits)) return `tel:${value.startsWith("+") ? "+" : ""}${digits}`
  return null
}

// «Показать демо» requests left on the public landing: who, which club, how
// many students and how to reach them. Read-only. Loads itself.
export function PlatformDemoRequests() {
  const [requests, setRequests] = useState<PlatformDemoRequest[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchPlatformDemoRequests()
      .then((res) => alive && setRequests(res.data))
      .catch((e) => alive && setError(errorMessage(e, "Не удалось загрузить заявки на демо.")))
    return () => {
      alive = false
    }
  }, [])

  const visible = requests && !showAll ? requests.slice(0, PREVIEW) : requests

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Заявки на демо</h2>
        <p className="text-sm text-muted-foreground">
          С публичной страницы ClubSpace. Клубы ждут звонка или сообщения.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {requests === null ? (
        !error && <div className="text-sm text-muted-foreground">Загрузка…</div>
      ) : requests.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Заявок пока нет.
        </div>
      ) : (
        <>
          <ul className="divide-y rounded-md border">
            {visible?.map((r) => {
              const href = contactHref(r.contact)
              return (
                <li key={r.id} className="space-y-1 px-3 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-medium">{r.clubName}</span>
                    {r.city && <span className="text-xs text-muted-foreground">{r.city}</span>}
                    {r.studentsCount !== null && (
                      <span className="text-xs text-muted-foreground">
                        {r.studentsCount} учеников
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {formatShortDate(r.createdAt)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.name} ·{" "}
                    {href ? (
                      <a
                        href={href}
                        className="text-primary underline-offset-4 hover:underline"
                        target={href.startsWith("http") ? "_blank" : undefined}
                        rel="noreferrer"
                      >
                        {r.contact}
                      </a>
                    ) : (
                      r.contact
                    )}
                  </div>
                  {r.comment && <p className="whitespace-pre-line">{r.comment}</p>}
                </li>
              )
            })}
          </ul>
          {requests.length > PREVIEW && (
            <button
              type="button"
              className="text-sm text-primary underline-offset-4 hover:underline"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Свернуть" : `Показать все (${requests.length})`}
            </button>
          )}
        </>
      )}
    </section>
  )
}
