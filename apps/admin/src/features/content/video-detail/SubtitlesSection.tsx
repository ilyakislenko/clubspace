"use client"

import { useRef, useState } from "react"

import { Button, Input, Label } from "@clubspace/ui-kit/ui"

import { errorMessage } from "../../../shared/lib/error-message"
import { safeExternalUrl } from "../../../shared/lib/safe-url"
import {
  createSubtitle,
  createSubtitleUpload,
  deleteSubtitle,
  getSubtitleCues,
  type SubtitleCues,
  type VideoSubtitleTrack,
} from "../../../shared/api/videos"
import { formatTimestamp } from "./TimestampsSection"
import {
  isAutoSubtitle,
  sourceBadgeClass,
  subtitleSourceLabel,
} from "./video-text-labels"

type Props = {
  workspaceId: string
  videoId: string
  subtitles: VideoSubtitleTrack[]
  onUploaded: (track: VideoSubtitleTrack) => void
  onRemoved: (subtitleId: string) => void
  onError: (message: string) => void
}

export function SubtitlesSection({
  workspaceId,
  videoId,
  subtitles,
  onUploaded,
  onRemoved,
  onError,
}: Props) {
  const [subLanguage, setSubLanguage] = useState("ru")
  const [subLabel, setSubLabel] = useState("")
  const [subUploading, setSubUploading] = useState(false)
  const [subRemovingId, setSubRemovingId] = useState<string | null>(null)
  const subFileRef = useRef<HTMLInputElement | null>(null)
  // «Просмотр»: the open track and its cues, read through the server.
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [preview, setPreview] = useState<SubtitleCues | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const togglePreview = async (subtitleId: string) => {
    if (previewId === subtitleId) {
      setPreviewId(null)
      return
    }
    setPreviewId(subtitleId)
    setPreview(null)
    setPreviewLoading(true)
    try {
      const cues = await getSubtitleCues({ workspaceId, videoId, subtitleId })
      setPreview(cues)
    } catch (error) {
      setPreviewId(null)
      onError(errorMessage(error, "Не удалось открыть субтитры."))
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleFile = async (file: File) => {
    const language = subLanguage.trim() || "ru"
    const labelOrFallback = subLabel.trim() || language.toUpperCase()
    const isVtt =
      file.type === "text/vtt" || file.name.toLowerCase().endsWith(".vtt")
    const isSrt =
      file.type === "application/x-subrip" ||
      file.name.toLowerCase().endsWith(".srt")
    if (!isVtt && !isSrt) {
      onError("Поддерживаются файлы .vtt и .srt.")
      return
    }
    const contentType: "text/vtt" | "application/x-subrip" = isVtt
      ? "text/vtt"
      : "application/x-subrip"

    setSubUploading(true)
    try {
      const upload = await createSubtitleUpload({
        workspaceId,
        videoId,
        language,
        contentType,
      })
      const putRes = await fetch(upload.upload.url, {
        method: upload.upload.method,
        headers: { "Content-Type": contentType },
        body: file,
      })
      if (!putRes.ok) {
        throw new Error(`S3 PUT failed: ${putRes.status}`)
      }
      const created = await createSubtitle({
        workspaceId,
        videoId,
        data: {
          language,
          label: labelOrFallback,
          storageKey: upload.key,
        },
      })
      onUploaded(created)
      setSubLabel("")
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setSubUploading(false)
      if (subFileRef.current) subFileRef.current.value = ""
    }
  }

  const handleRemove = async (subtitleId: string) => {
    setSubRemovingId(subtitleId)
    try {
      await deleteSubtitle({ workspaceId, videoId, subtitleId })
      onRemoved(subtitleId)
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setSubRemovingId(null)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between">
        <div>
          <Label className="text-sm font-medium">Субтитры</Label>
          <p className="text-xs text-muted-foreground">
            Файлы .vtt или .srt. Один трек на язык.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {subtitles.length}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={subLanguage}
          onChange={(event) => setSubLanguage(event.target.value)}
          placeholder="ru / en / pt-br"
          className="h-9 w-[110px]"
        />
        <Input
          value={subLabel}
          onChange={(event) => setSubLabel(event.target.value)}
          placeholder="Подпись (по умолчанию = язык)"
          className="h-9 flex-1 min-w-[180px]"
        />
        <input
          ref={subFileRef}
          type="file"
          accept=".vtt,.srt,text/vtt,application/x-subrip"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />
        <Button
          type="button"
          size="sm"
          onClick={() => subFileRef.current?.click()}
          disabled={subUploading || !subLanguage.trim()}
        >
          {subUploading ? "Загружаем..." : "Загрузить файл"}
        </Button>
      </div>

      {subtitles.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Субтитры пока не подгружены.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {subtitles.map((s) => (
            <li key={s.id} className="px-3 py-2 text-sm">
              <div className="flex items-center gap-3">
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs uppercase">
                  {s.language}
                </code>
                <span className="flex-1 truncate">{s.label}</span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${sourceBadgeClass(isAutoSubtitle(s.source))}`}
                >
                  {subtitleSourceLabel(s.source)}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-expanded={previewId === s.id}
                  onClick={() => void togglePreview(s.id)}
                >
                  {previewId === s.id ? "Скрыть" : "Просмотр"}
                </Button>
                {(() => {
                  const safe = safeExternalUrl(s.publicUrl)
                  return safe ? (
                    <a
                      href={safe}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      Файл
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground/60">Файл</span>
                  )
                })()}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleRemove(s.id)}
                  disabled={subRemovingId === s.id}
                >
                  {subRemovingId === s.id ? "..." : "Удалить"}
                </Button>
              </div>
              {previewId === s.id && (
                <div className="mt-2 rounded-md bg-muted/50 p-2 text-xs">
                  {previewLoading || !preview ? (
                    <p className="text-muted-foreground">Загружаем…</p>
                  ) : preview.cues.length === 0 ? (
                    <p className="text-muted-foreground">В файле нет фраз.</p>
                  ) : (
                    <>
                      <ol className="max-h-64 space-y-1 overflow-auto">
                        {preview.cues.map((cue, i) => (
                          <li key={i} className="flex gap-2">
                            <code className="shrink-0 text-muted-foreground">
                              {formatTimestamp(cue.from)}
                            </code>
                            <span className="whitespace-pre-line">{cue.text}</span>
                          </li>
                        ))}
                      </ol>
                      {preview.total > preview.cues.length && (
                        <p className="mt-1 text-muted-foreground">
                          Показаны первые {preview.cues.length} из {preview.total}.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
