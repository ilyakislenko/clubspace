"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { Button, Label } from "@clubspace/ui-kit/ui"

import { errorMessage } from "../../../shared/lib/error-message"
import { pluralRu } from "../../../shared/lib/plural-ru"
import { confirmDialog } from "../../../shared/ui/confirm-dialog"
import {
  getVideoTextStatus,
  regenerateVideoText,
  type VideoTextStatus,
} from "../../../shared/api/videos"
import { regenerationLabel, transcriptSummary } from "./video-text-labels"

// While «Пересоздать» is queued or running, the status is re-read this often.
export const REGENERATION_POLL_MS = 10_000

type Props = {
  workspaceId: string
  videoId: string
  // Chapters or subtitles changed (removed for a redo, or remade): reload them.
  onChanged: () => void
  onError: (message: string) => void
}

/**
 * «Расшифровка и автоматика»: what the video worker made from the lesson —
 * transcript, automatic chapters and subtitles — and «Пересоздать», which
 * removes the automatic ones (never staff's) and has the worker make them
 * again from the stored transcript.
 */
export function VideoTextSection({ workspaceId, videoId, onChanged, onError }: Props) {
  const [status, setStatus] = useState<VideoTextStatus | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const pendingRef = useRef(false)
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  const load = useCallback(async () => {
    try {
      const next = await getVideoTextStatus({ workspaceId, videoId })
      setStatus(next)
      // A regeneration just finished: the new chapters/subtitles are in.
      if (pendingRef.current && !next.regeneration) onChangedRef.current()
      pendingRef.current = next.regeneration !== null
    } catch (error) {
      onError(errorMessage(error, "Не удалось узнать состояние расшифровки."))
    }
  }, [workspaceId, videoId, onError])

  useEffect(() => {
    void load()
  }, [load])

  const pending = status?.regeneration ?? null
  useEffect(() => {
    if (!pending) return
    const id = setInterval(() => void load(), REGENERATION_POLL_MS)
    return () => clearInterval(id)
  }, [pending, load])

  const regenerate = async (what: { chapters: boolean; subtitles: boolean }) => {
    if (!status) return
    const auto = what.chapters ? status.chapters.auto : status.subtitles.auto
    const removed =
      auto === 0
        ? null
        : what.chapters
          ? `${auto} ${pluralRu(auto, "автоматическая глава удалится", "автоматические главы удалятся", "автоматических глав удалятся")}.`
          : `${auto} ${pluralRu(auto, "автоматическая дорожка субтитров удалится", "автоматические дорожки субтитров удалятся", "автоматических дорожек субтитров удалятся")}.`
    const remade = what.chapters
      ? "Сервер сделает главы заново по расшифровке."
      : "Сервер сделает субтитры заново по расшифровке, загруженные вручную останутся."
    const ok = await confirmDialog({
      title: what.chapters ? "Пересоздать главы?" : "Пересоздать субтитры?",
      description: removed ? `${removed} ${remade}` : remade,
      confirmLabel: "Пересоздать",
    })
    if (!ok) return
    setSubmitting(true)
    try {
      await regenerateVideoText({ workspaceId, videoId, data: what })
      pendingRef.current = true
      setStatus((prev) => (prev ? { ...prev, regeneration: "waiting" } : prev))
      // The automatic rows are gone until the worker remakes them.
      onChangedRef.current()
    } catch (error) {
      onError(errorMessage(error, "Не удалось запустить пересоздание."))
    } finally {
      setSubmitting(false)
    }
  }

  if (!status) {
    return (
      <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        Загружаем расшифровку…
      </div>
    )
  }

  const ready = status.videoStatus === "ready"
  const busy = submitting || pending !== null
  const hasManualChapters = status.chapters.manual > 0
  const progress = regenerationLabel(status)

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <Label className="text-sm font-medium">Расшифровка и автоматика</Label>
        <p className="text-xs text-muted-foreground">
          Главы и субтитры, которые сервер делает сам по речи и титрам на экране.
        </p>
      </div>
      <ul className="space-y-1 text-sm">
        <li>{transcriptSummary(status)}</li>
        <li>
          Главы: {status.chapters.manual} вручную, {status.chapters.auto} автоматических.
        </li>
        <li>
          Субтитры: {status.subtitles.manual} загружено, {status.subtitles.auto} автоматических.
        </li>
      </ul>
      {progress && (
        <p role="status" className="text-sm text-primary">
          {progress}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void regenerate({ chapters: true, subtitles: false })}
          disabled={!ready || busy || hasManualChapters}
        >
          Пересоздать главы
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void regenerate({ chapters: false, subtitles: true })}
          disabled={!ready || busy}
        >
          Пересоздать субтитры
        </Button>
      </div>
      {hasManualChapters && (
        <p className="text-xs text-muted-foreground">
          Главы пересоздаются, только когда у видео нет ручных глав: автоматические с
          ручными не смешиваются.
        </p>
      )}
    </div>
  )
}
