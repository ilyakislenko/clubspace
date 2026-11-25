"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import {
  cancelClubMessage,
  getClubMessage,
  listClubMessageRecipients,
  type ClubMessage,
  type ClubMessageRecipient,
} from "../../shared/api/messages"
import { errorMessage } from "../../shared/lib/error-message"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import {
  countersLine,
  flagsText,
  PUSH_SKIP_TEXT,
  readState,
  statusLabel,
} from "./message-view"

const PER_PAGE = 50

type Props = {
  workspaceId: string
  // `?message=`: the open message's id.
  messageId: string | null
  timezone: string
  onClose: () => void
  onChanged: () => void
}

/**
 * One message in a side panel: the text, how it went (flags, counters) and
 * who got it — opened or not, and why a push wasn't sent. A scheduled
 * message can be stopped here; recipients exist only once it went out.
 */
export function MessageDetailSheet({
  workspaceId,
  messageId,
  timezone,
  onClose,
  onChanged,
}: Props) {
  const [message, setMessage] = useState<ClubMessage | null>(null)
  const [rows, setRows] = useState<ClubMessageRecipient[]>([])
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const load = useCallback(async () => {
    if (!messageId) return
    try {
      const [m, recipients] = await Promise.all([
        getClubMessage({ workspaceId, messageId }),
        listClubMessageRecipients({ workspaceId, messageId, perPage: PER_PAGE }),
      ])
      setMessage(m)
      setRows(recipients.data)
      setTotal(recipients.total)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить сообщение"))
    }
  }, [workspaceId, messageId])

  useEffect(() => {
    setMessage(null)
    setRows([])
    setTotal(0)
    setError(null)
    void load()
  }, [load])

  const more = async () => {
    if (!messageId || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await listClubMessageRecipients({
        workspaceId,
        messageId,
        curPage: Math.floor(rows.length / PER_PAGE) + 1,
        perPage: PER_PAGE,
      })
      const seen = new Set(rows.map((r) => r.userId))
      setRows([...rows, ...res.data.filter((r) => !seen.has(r.userId))])
      setTotal(res.total)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить получателей"))
    } finally {
      setLoadingMore(false)
    }
  }

  const cancel = async () => {
    if (!message) return
    const ok = await confirmDialog({
      title: "Отменить отправку?",
      description: `Сообщение «${message.title}» не уйдёт: ${message.audienceLabel}.`,
      confirmLabel: "Отменить отправку",
      cancelLabel: "Оставить",
      destructive: true,
    })
    if (!ok) return
    setCancelling(true)
    setError(null)
    try {
      setMessage(await cancelClubMessage({ workspaceId, messageId: message.id }))
      onChanged()
    } catch (e) {
      setError(errorMessage(e, "Не удалось отменить отправку"))
    } finally {
      setCancelling(false)
    }
  }

  const flags = message ? flagsText(message) : null
  const now = new Date()

  return (
    <Sheet open={messageId !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="pr-6">{message?.title ?? "Сообщение"}</SheetTitle>
          <SheetDescription>
            {message
              ? `${message.audienceLabel} · ${message.authorName} · ${statusLabel(message, timezone, now)}`
              : "Загрузка…"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto text-sm">
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </p>
          )}
          {message && (
            <>
              <p className="whitespace-pre-wrap">{message.body}</p>
              {flags && <p className="text-xs text-muted-foreground">{flags}</p>}

              {message.status === "SENT" && (
                <section className="space-y-2">
                  <h3 className="font-medium">{countersLine(message)}</h3>
                  {rows.length > 0 && (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {rows.map((r) => (
                        <li key={r.userId} className="flex items-start gap-3 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/workspace/${workspaceId}/users/${r.userId}`}
                              className="block truncate font-medium hover:underline"
                            >
                              {r.name}
                            </Link>
                            {r.isDependent && r.guardianNames.length > 0 && (
                              <p className="truncate text-xs text-muted-foreground">
                                Родителям: {r.guardianNames.join(", ")}
                              </p>
                            )}
                            {r.pushSkip && (
                              <p className="text-xs text-muted-foreground">
                                {PUSH_SKIP_TEXT[r.pushSkip]}
                              </p>
                            )}
                          </div>
                          <span
                            className={`shrink-0 whitespace-nowrap text-xs ${
                              r.readAt ? "text-foreground" : "text-muted-foreground"
                            }`}
                          >
                            {readState(r.readAt, timezone)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {rows.length < total && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={loadingMore}
                      onClick={() => void more()}
                    >
                      {loadingMore ? "Загружаем…" : "Показать ещё"}
                    </Button>
                  )}
                </section>
              )}
              {message.status === "SCHEDULED" && (
                <p className="text-muted-foreground">
                  Получателей посчитаем в момент отправки: кто будет в списке тогда.
                </p>
              )}
            </>
          )}
        </div>

        {/* Below the sport leads the list holds only one's own messages:
            whoever sees a scheduled one may stop it (author or sport lead). */}
        {message?.status === "SCHEDULED" && (
          <SheetFooter>
            <Button
              type="button"
              variant="outline"
              disabled={cancelling}
              onClick={() => void cancel()}
            >
              {cancelling ? "Отменяем…" : "Отменить отправку"}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}
