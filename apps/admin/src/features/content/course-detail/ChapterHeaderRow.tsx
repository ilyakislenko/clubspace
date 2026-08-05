"use client"

import { useEffect, useState } from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, Trash2 } from "lucide-react"

import { Button, Input } from "@clubspace/ui-kit/ui"

import { type CoursePlaylistChapter } from "../../../shared/api/playlists"
import { chapterDragId } from "./helpers"

type Props = {
  // null = pseudo-section "Без раздела".
  chapter: CoursePlaylistChapter | null
  onRename: (chapterId: string, title: string) => Promise<void> | void
  onDelete: (chapter: CoursePlaylistChapter) => Promise<void> | void
  reordering: boolean
}

export function ChapterHeaderRow({
  chapter,
  onRename,
  onDelete,
  reordering,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(chapter?.title ?? "")

  const dragId = chapterDragId(chapter?.id ?? null)
  const draggable = chapter !== null
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: dragId, disabled: !draggable })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  useEffect(() => {
    setDraft(chapter?.title ?? "")
  }, [chapter?.title])

  const commit = () => {
    if (!chapter) return
    setEditing(false)
    if (draft.trim() && draft.trim() !== chapter.title) {
      void onRename(chapter.id, draft)
    } else {
      setDraft(chapter.title)
    }
  }

  const cancel = () => {
    setEditing(false)
    setDraft(chapter?.title ?? "")
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1 border-b border-border bg-muted/40"
    >
      {draggable ? (
        <button
          type="button"
          aria-label="Перетащить раздел"
          className="cursor-grab touch-none px-2 py-1.5 text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:opacity-50"
          disabled={reordering}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      ) : (
        <span aria-hidden className="px-2 py-1.5 opacity-0">
          <GripVertical className="size-4" />
        </span>
      )}

      {editing && chapter ? (
        <>
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit()
              if (event.key === "Escape") cancel()
            }}
            placeholder="Например: Атаки с гарда"
            className="h-7 max-w-xs text-xs"
          />
          <Button type="button" size="sm" variant="ghost" onClick={commit}>
            Сохранить
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={cancel}>
            Отмена
          </Button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => chapter && setEditing(true)}
            disabled={!chapter}
            className={`flex-1 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              chapter
                ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                : "italic text-muted-foreground/60"
            }`}
            title={
              chapter ? "Нажмите, чтобы переименовать раздел" : undefined
            }
          >
            {chapter?.title ?? "Без раздела"}
          </button>
          {chapter && (
            <button
              type="button"
              aria-label="Удалить раздел"
              onClick={() => void onDelete(chapter)}
              className="px-2 py-1.5 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </>
      )}
    </li>
  )
}
