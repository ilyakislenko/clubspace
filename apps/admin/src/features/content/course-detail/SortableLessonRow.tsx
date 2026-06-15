"use client"

import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical } from "lucide-react"

import { Button } from "@bjj-academy/ui-kit/ui"

import { type CoursePlaylistVideo } from "../../../shared/api/playlists"
import { formatDuration } from "./helpers"

type Props = {
  video: CoursePlaylistVideo
  index: number
  onOpen: () => void
  onRemove: () => void
  removing: boolean
  reordering: boolean
}

const LESSON_STATUS_LABEL: Record<string, string> = {
  ready: "Готово",
  uploaded: "Загружено",
  uploading: "Загружается",
  processing: "Обработка",
  failed: "Ошибка",
}

const LESSON_STATUS_CLASS: Record<string, string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  uploaded: "bg-sky-50 text-sky-700 ring-sky-600/20",
  uploading: "bg-amber-50 text-amber-700 ring-amber-600/20",
  processing: "bg-amber-50 text-amber-700 ring-amber-600/20",
  failed: "bg-red-50 text-red-700 ring-red-600/20",
}

function LessonStatusBadge({ status }: { status: string }) {
  const cls =
    LESSON_STATUS_CLASS[status] ?? "bg-zinc-100 text-zinc-700 ring-zinc-600/20"
  const label = LESSON_STATUS_LABEL[status] ?? status
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cls}`}
    >
      {label}
    </span>
  )
}

export function SortableLessonRow({
  video,
  index,
  onOpen,
  onRemove,
  removing,
  reordering,
}: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: video.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    background: isDragging ? "var(--muted, #f4f4f5)" : undefined,
  }

  const duration = formatDuration(video.duration)

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex flex-wrap items-center gap-3 p-3 transition-colors hover:bg-muted/40"
    >
      <button
        type="button"
        aria-label="Перетащить"
        className="cursor-grab touch-none p-1 text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:opacity-50"
        disabled={reordering}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <span className="w-6 text-xs text-muted-foreground">№{index + 1}</span>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80"
      >
        <div className="h-12 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
          {video.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={video.thumbnailUrl}
              alt={video.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
              Нет превью
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="truncate text-sm font-medium">{video.title}</div>
          <div className="flex flex-wrap items-center gap-2">
            <LessonStatusBadge status={video.status} />
            {duration && (
              <span className="text-xs text-muted-foreground">{duration}</span>
            )}
          </div>
        </div>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRemove}
        disabled={removing}
      >
        {removing ? "Убираем..." : "Убрать"}
      </Button>
    </li>
  )
}
