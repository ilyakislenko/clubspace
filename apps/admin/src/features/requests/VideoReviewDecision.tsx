"use client"

import { MoreHorizontal } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Label,
  Textarea,
} from "@clubspace/ui-kit/ui"

import {
  addVideoReviewComment,
  deleteVideoReviewComment,
  getVideoReview,
  getVideoReviewPlayback,
  setVideoReviewStatus,
  type VideoReview,
  type VideoReviewComment,
} from "../../shared/api/video-reviews"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { PlyrPlayer, type PlyrPlayerHandle } from "../video-player/plyr-player"
import { ErrorNote, Fact, Facts, isGoneError, useDecision, type DecisionProps } from "./decision-kit"
import { formatClipTime, formatSentAt } from "./request-view"

const TEXT = FORM_LIMITS.videoComment.text

/**
 * «Разбор видео»: watch the clip, comment on moments (a comment takes the
 * player's current second), then mark it answered (the member is notified) or
 * close it (staff may reopen in the app). Drawing on frames and editing
 * comments stay in the app.
 */
export function VideoReviewDecision(props: DecisionProps) {
  const { workspaceId, request, onGone } = props
  const [review, setReview] = useState<VideoReview | null>(null)
  const [hlsUrl, setHlsUrl] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [currentSec, setCurrentSec] = useState(0)
  const [text, setText] = useState("")
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const player = useRef<PlyrPlayerHandle>(null)
  const { busy, error, setError, decide } = useDecision(props)

  useDirtyGuard(text.trim() !== "")

  const ready = request.video?.clipStatus === "ready"

  useEffect(() => {
    let alive = true
    const ids = { workspaceId, requestId: request.requestId }
    getVideoReview(ids)
      .then((r) => alive && setReview(r))
      .catch((e: unknown) => {
        if (!alive) return
        if (isGoneError(e)) onGone(errorMessage(e, ""))
        else setLoadError(errorMessage(e, "Не удалось открыть разбор"))
      })
    if (ready) {
      getVideoReviewPlayback(ids)
        .then((p) => alive && setHlsUrl(p.hlsUrl))
        .catch((e: unknown) => alive && setLoadError(errorMessage(e, "Не удалось загрузить видео")))
    }
    return () => {
      alive = false
    }
    // `onGone` is the sheet's; a new one must not reload the review.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, request.requestId, ready])

  const comments = [...(review?.comments ?? [])].sort((a, b) => a.atSec - b.atSec)

  const add = async () => {
    const body = text.trim()
    if (!body || adding) return
    setAdding(true)
    setError(null)
    try {
      setReview(
        await addVideoReviewComment({
          workspaceId,
          requestId: request.requestId,
          data: { atSec: currentSec, text: body },
        }),
      )
      setText("")
    } catch (e) {
      setError(errorMessage(e, "Не удалось добавить комментарий"))
    } finally {
      setAdding(false)
    }
  }

  const remove = async (comment: VideoReviewComment) => {
    const ok = await confirmDialog({
      title: "Удалить комментарий?",
      description: "Ученик его больше не увидит.",
      confirmLabel: "Удалить",
      destructive: true,
    })
    if (!ok) return
    setDeletingId(comment.id)
    setError(null)
    try {
      setReview(
        await deleteVideoReviewComment({
          workspaceId,
          requestId: request.requestId,
          commentId: comment.id,
        }),
      )
    } catch (e) {
      setError(errorMessage(e, "Не удалось удалить комментарий"))
    } finally {
      setDeletingId(null)
    }
  }

  const setStatus = (status: "answered" | "closed") =>
    decide(
      () => setVideoReviewStatus({ workspaceId, requestId: request.requestId, data: { status } }),
      status === "answered" ? "Не удалось отметить разбор отвеченным" : "Не удалось закрыть разбор",
    )

  return (
    <div className="flex flex-col gap-4">
      <Facts>
        <Fact label="Название">{request.video?.title}</Fact>
        <Fact label="Сообщение">{request.video?.message}</Fact>
        <Fact label="Отправлено">{formatSentAt(request.createdAt, new Date())}</Fact>
      </Facts>

      {loadError && <ErrorNote message={loadError} />}

      {ready ? (
        hlsUrl ? (
          <PlyrPlayer ref={player} src={hlsUrl} title={request.video?.title} onTimeUpdate={setCurrentSec} />
        ) : (
          !loadError && <div className="aspect-video animate-pulse rounded-md bg-muted" />
        )
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Видео ещё обрабатывается
        </p>
      )}

      {comments.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {comments.map((c) => (
            <li key={c.id} className="flex items-start gap-2 px-3 py-2">
              <button
                type="button"
                className="min-w-0 flex-1 text-left hover:underline disabled:no-underline"
                disabled={!hlsUrl}
                onClick={() => player.current?.seek(c.atSec)}
              >
                <span className="font-medium tabular-nums">{formatClipTime(c.atSec)}</span>
                <span className="text-muted-foreground"> · </span>
                <span className="whitespace-pre-line break-words">{c.text}</span>
                <span className="text-muted-foreground"> · {c.author.name}</span>
              </button>
              {c.mine && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0"
                      disabled={deletingId !== null}
                      aria-label={`Действия с комментарием на ${formatClipTime(c.atSec)}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem className="text-destructive" onSelect={() => void remove(c)}>
                      Удалить
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          ))}
        </ul>
      )}

      {hlsUrl && (
        <form
          className="grid gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <Label htmlFor="video-comment">Комментарий на {formatClipTime(currentSec)}</Label>
          <Textarea
            id="video-comment"
            rows={2}
            value={text}
            maxLength={TEXT.max}
            disabled={adding}
            onChange={(e) => setText(e.target.value)}
          />
          <div>
            <Button type="submit" variant="outline" size="sm" disabled={adding || text.trim() === ""}>
              {adding ? "Добавляем…" : "Добавить"}
            </Button>
          </div>
        </form>
      )}

      {error && <ErrorNote message={error} />}

      {/* The server refuses either status until the clip is processed. */}
      <div className="flex flex-wrap items-start gap-2">
        <div className="space-y-1">
          <Button
            type="button"
            disabled={busy || !ready}
            aria-describedby="video-answered-hint"
            onClick={() => void setStatus("answered")}
          >
            Отметить отвеченным
          </Button>
          <p id="video-answered-hint" className="text-xs text-muted-foreground">
            Ученик получит уведомление
          </p>
        </div>
        <Button type="button" variant="ghost" disabled={busy || !ready} onClick={() => void setStatus("closed")}>
          Закрыть разбор
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Рисовать на кадре и править комментарии можно в приложении
      </p>
    </div>
  )
}
