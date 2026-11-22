"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import { listOpenRequests, type OpenRequest } from "../../shared/api/requests"
import { confirmLeave } from "../../shared/lib/use-dirty-guard"
import { useVocabulary } from "../../shared/lib/vocabulary"
import type { DecisionProps } from "./decision-kit"
import { FreezeDecision } from "./FreezeDecision"
import { JoinDecision } from "./JoinDecision"
import { PersonalDecision } from "./PersonalDecision"
import { kindLabel, REQUEST_KINDS } from "./request-view"
import { VideoReviewDecision } from "./VideoReviewDecision"

// A row looked up in its kind's queue: the server's page cap, and its depth
// guard (curPage × perPage ≤ 1000).
const LOOKUP_PAGE = 100
const LOOKUP_DEPTH = 1000

type Lookup = { id: string; row: OpenRequest | null; failed: boolean }

type Props = {
  workspaceId: string
  // `?request=`: the open row's id (`join:<id>`, `freeze:<uuid>`, …).
  requestId: string | null
  // The row as the list last loaded it; null when it left the list (decided
  // elsewhere) or the list has not loaded yet.
  request: OpenRequest | null
  listLoaded: boolean
  viewerId: string | null
  // The join row's «Отклонить» opens the panel straight in decline mode.
  startInDecline: boolean
  onClose: () => void
  // Decided here, or found decided elsewhere: the list reloads.
  onChanged: () => void
}

/**
 * The side panel of one request: kind and name, the facts, and the decision
 * with the existing endpoints. A row the list hasn't loaded (a later page,
 * another `?kind=`, or decided elsewhere) is looked up in its kind's queue
 * first; only a request that is gone there, or a decision answered 409/404,
 * shows «Заявку уже рассмотрели» with no buttons.
 */
export function RequestSheet({
  workspaceId,
  requestId,
  request,
  listLoaded,
  viewerId,
  startInDecline,
  onClose,
  onChanged,
}: Props) {
  const vocabulary = useVocabulary()
  // The last loaded state of the open row: its heading outlives the row.
  const [shown, setShown] = useState<OpenRequest | null>(null)
  // The server's words when a decision found the request already decided.
  const [gone, setGone] = useState<string | null>(null)
  const [lookup, setLookup] = useState<Lookup | null>(null)

  useEffect(() => {
    setGone(null)
    setShown(null)
  }, [requestId])

  useEffect(() => {
    if (!requestId || !listLoaded || request || gone !== null) return
    const kind = REQUEST_KINDS.find((k) => requestId.startsWith(`${k}:`))
    if (!kind) {
      setLookup({ id: requestId, row: null, failed: false })
      return
    }
    let alive = true
    void (async () => {
      try {
        for (let curPage = 1; ; curPage++) {
          const res = await listOpenRequests({ workspaceId, kind, curPage, perPage: LOOKUP_PAGE })
          const row = res.data.find((r) => r.id === requestId) ?? null
          const seen = curPage * LOOKUP_PAGE
          if (row || seen >= res.total || res.data.length < LOOKUP_PAGE || seen >= LOOKUP_DEPTH) {
            if (alive) setLookup({ id: requestId, row, failed: false })
            return
          }
        }
      } catch {
        if (alive) setLookup({ id: requestId, row: null, failed: true })
      }
    })()
    return () => {
      alive = false
    }
  }, [workspaceId, requestId, listLoaded, request, gone])

  const looked = lookup?.id === requestId ? lookup : null
  const row = request ?? (listLoaded ? (looked?.row ?? null) : null)

  useEffect(() => {
    if (row) setShown(row)
  }, [row])

  const requestClose = async () => {
    if (await confirmLeave()) onClose()
  }

  const current = row ?? shown
  const lookupFailed = !row && gone === null && looked?.failed === true
  const decided =
    gone !== null || (listLoaded && !row && looked !== null && !looked.failed)
  const props: DecisionProps | null =
    row && !decided
      ? {
          workspaceId,
          request: row,
          viewerId,
          onDone: () => {
            onClose()
            onChanged()
          },
          onGone: (message) => {
            setGone(message)
            onChanged()
          },
        }
      : null

  return (
    <Sheet open={requestId !== null} onOpenChange={(open) => !open && void requestClose()}>
      <SheetContent
        className={`flex w-full flex-col gap-4 overflow-y-auto ${current?.kind === "video" ? "sm:max-w-xl" : "sm:max-w-md"}`}
      >
        <SheetHeader>
          <SheetTitle className="pr-6">
            {current ? `${kindLabel(current.kind, vocabulary)} · ${current.member.name}` : "Заявка"}
          </SheetTitle>
          <SheetDescription className={current && current.kind !== "join" ? "" : "sr-only"}>
            {current && current.kind !== "join" ? (
              <Link href={`/workspace/${workspaceId}/users/${current.member.userId}`} className="underline-offset-4 hover:underline">
                Открыть карточку ученика
              </Link>
            ) : (
              "Заявка ученика"
            )}
          </SheetDescription>
        </SheetHeader>

        {lookupFailed ? (
          <div className="space-y-3">
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Не удалось открыть заявку
            </p>
            <Button type="button" variant="outline" onClick={onClose}>
              Закрыть
            </Button>
          </div>
        ) : decided ? (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <p className="font-medium">Заявку уже рассмотрели</p>
              {gone && <p className="text-muted-foreground">{gone}</p>}
            </div>
            <Button type="button" variant="outline" onClick={onClose}>
              Закрыть
            </Button>
          </div>
        ) : props ? (
          props.request.kind === "join" ? (
            <JoinDecision key={props.request.id} {...props} startInDecline={startInDecline} />
          ) : props.request.kind === "freeze" ? (
            <FreezeDecision key={props.request.id} {...props} />
          ) : props.request.kind === "personal" ? (
            <PersonalDecision key={props.request.id} {...props} />
          ) : (
            <VideoReviewDecision key={props.request.id} {...props} />
          )
        ) : (
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        )}
      </SheetContent>
    </Sheet>
  )
}
