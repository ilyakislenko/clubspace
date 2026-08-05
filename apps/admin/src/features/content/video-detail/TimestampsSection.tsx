"use client"

import { useState } from "react"

import { Button, Input, Label } from "@clubspace/ui-kit/ui"

import { errorMessage } from "../../../shared/lib/error-message"
import {
  createVideoTimestamp,
  deleteVideoTimestamp,
} from "../../../shared/api/videos"

type Timestamp = { id: string; positionSec: number; title: string }

type Props = {
  workspaceId: string
  videoId: string
  duration?: number | null
  timestamps: Timestamp[]
  onAdded: (timestamp: Timestamp) => void
  onRemoved: (timestampId: string) => void
  onError: (message: string) => void
}

// Accepts "MM:SS" or "HH:MM:SS"; returns total seconds or null when the input
// doesn't match. Keeps the form forgiving (the typist can shape it however
// reads naturally for the part of the video they're looking at).
const parseTimestamp = (raw: string): number | null => {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10)
  const parts = trimmed.split(":")
  if (parts.length < 2 || parts.length > 3) return null
  const numbers = parts.map((p) => Number(p))
  if (numbers.some((n) => Number.isNaN(n) || n < 0)) return null
  if (parts.length === 2) return numbers[0] * 60 + numbers[1]
  return numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
}

export const formatTimestamp = (positionSec: number): string => {
  const total = Math.max(0, Math.floor(positionSec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${m}:${String(s).padStart(2, "0")}`
}

export function TimestampsSection({
  workspaceId,
  videoId,
  duration,
  timestamps,
  onAdded,
  onRemoved,
  onError,
}: Props) {
  const [tsPosition, setTsPosition] = useState("")
  const [tsTitle, setTsTitle] = useState("")
  const [tsAdding, setTsAdding] = useState(false)
  const [tsRemovingId, setTsRemovingId] = useState<string | null>(null)

  const handleAdd = async () => {
    const positionSec = parseTimestamp(tsPosition)
    const title = tsTitle.trim()
    if (positionSec === null) {
      onError("Не понял время. Используй MM:SS или HH:MM:SS.")
      return
    }
    if (!title) {
      onError("Дай название — иначе по списку не сориентироваться.")
      return
    }
    // Bound check: if duration is known, warn before the round-trip. Server
    // enforces the same rule, so old uploads with null duration still get
    // caught there once the player back-fills duration.
    if (typeof duration === "number" && duration > 0 && positionSec > duration) {
      onError(`Время за пределами видео (${formatTimestamp(duration)}).`)
      return
    }
    setTsAdding(true)
    try {
      const created = await createVideoTimestamp({
        workspaceId,
        videoId,
        positionSec,
        title,
      })
      onAdded(created)
      setTsPosition("")
      setTsTitle("")
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setTsAdding(false)
    }
  }

  const handleRemove = async (timestampId: string) => {
    setTsRemovingId(timestampId)
    try {
      await deleteVideoTimestamp({ workspaceId, videoId, timestampId })
      onRemoved(timestampId)
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setTsRemovingId(null)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between">
        <div>
          <Label className="text-sm font-medium">Тайм-коды</Label>
          <p className="text-xs text-muted-foreground">
            Главы внутри видео. Ученики смогут прыгнуть к нужному моменту.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {timestamps.length}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={tsPosition}
          onChange={(event) => setTsPosition(event.target.value)}
          placeholder="0:30 / 1:23:45"
          className="h-9 w-[110px]"
        />
        <Input
          value={tsTitle}
          onChange={(event) => setTsTitle(event.target.value)}
          placeholder="Что в этом моменте"
          className="h-9 flex-1 min-w-[180px]"
        />
        <Button
          type="button"
          size="sm"
          onClick={() => void handleAdd()}
          disabled={tsAdding || !tsPosition.trim() || !tsTitle.trim()}
        >
          {tsAdding ? "Добавляем..." : "+ Тайм-код"}
        </Button>
      </div>
      {timestamps.length === 0 ? (
        <p className="text-xs text-muted-foreground">Пока нет тайм-кодов.</p>
      ) : (
        <ol className="divide-y divide-border rounded-md border border-border">
          {timestamps.map((ts) => (
            <li
              key={ts.id}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {formatTimestamp(ts.positionSec)}
              </code>
              <span className="flex-1 truncate">{ts.title}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void handleRemove(ts.id)}
                disabled={tsRemovingId === ts.id}
              >
                {tsRemovingId === ts.id ? "..." : "Удалить"}
              </Button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
