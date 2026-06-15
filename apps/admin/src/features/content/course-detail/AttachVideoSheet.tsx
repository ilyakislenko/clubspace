"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, Search } from "lucide-react"

import {
  Button,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@bjj-academy/ui-kit/ui"

import { attachVideosToPlaylist } from "../../../shared/api/playlists"
import { listVideos } from "../../../shared/api/videos"
import { type WorkspaceVideo } from "./helpers"

type Props = {
  workspaceId: string
  courseId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // Ids already attached to the course — filtered out of the picker.
  inCourseIds: Set<string>
  onAttached: () => Promise<void> | void
  onError: (message: string) => void
}

export function AttachVideoSheet({
  workspaceId,
  courseId,
  open,
  onOpenChange,
  inCourseIds,
  onAttached,
  onError,
}: Props) {
  const [allVideos, setAllVideos] = useState<WorkspaceVideo[]>([])
  const [allVideosLoading, setAllVideosLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set())
  const [attachSaving, setAttachSaving] = useState(false)

  // Fresh picker each time it opens.
  useEffect(() => {
    if (!open) return
    setSearch("")
    setDebouncedSearch("")
    setPickedIds(new Set())
  }, [open])

  // Debounce the picker search so each keystroke doesn't hit the API.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(handle)
  }, [search])

  // Server-side search for the attach picker: refetch on open and whenever the
  // debounced query changes, instead of capping at 200 videos loaded once and
  // filtering client-side (which hid everything past the 200th video).
  useEffect(() => {
    if (!open || !workspaceId) return
    let cancelled = false
    setAllVideosLoading(true)
    void listVideos({
      workspaceId,
      perPage: 50,
      q: debouncedSearch || undefined,
    })
      .then((response) => {
        if (cancelled) return
        setAllVideos(
          response.data.map((v) => ({
            id: v.id,
            title: v.title,
            status: v.status,
            thumbnailUrl: v.thumbnailUrl,
            duration: v.duration,
          })),
        )
      })
      .catch((err) => {
        if (cancelled) return
        onError(
          err instanceof Error ? err.message : "Не удалось загрузить видео.",
        )
      })
      .finally(() => {
        if (!cancelled) setAllVideosLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debouncedSearch, workspaceId])

  const candidates = useMemo(() => {
    // Title matching is done server-side (q); here we only drop videos already
    // attached to this course.
    return allVideos.filter((video) => !inCourseIds.has(video.id))
  }, [allVideos, inCourseIds])

  const togglePick = (id: string) => {
    setPickedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAttach = async () => {
    if (!workspaceId || !courseId || pickedIds.size === 0) return
    setAttachSaving(true)
    try {
      await attachVideosToPlaylist({
        workspaceId,
        playlistId: courseId,
        videoIds: Array.from(pickedIds),
      })
      await onAttached()
      onOpenChange(false)
    } catch (err) {
      onError(err instanceof Error ? err.message : "Не удалось добавить видео.")
    } finally {
      setAttachSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-4 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Добавить видео в курс</SheetTitle>
          <SheetDescription>
            Выберите одно или несколько видео — они появятся в конце курса.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 rounded-md border border-border px-2">
          <Search className="size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по названию"
            className="h-9 border-none p-0 focus-visible:ring-0"
          />
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto">
          {allVideosLoading && (
            <div className="text-sm text-muted-foreground">Загружаем...</div>
          )}
          {!allVideosLoading && candidates.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {search.trim()
                ? "Ничего не найдено."
                : "Все видео воркспейса уже в курсе."}
            </p>
          )}
          {candidates.map((video) => {
            const checked = pickedIds.has(video.id)
            return (
              <button
                key={video.id}
                type="button"
                onClick={() => togglePick(video.id)}
                className="flex w-full items-center gap-3 rounded-md border border-border p-2 text-left hover:bg-muted"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border">
                  {checked && <Check className="size-4" />}
                </span>
                <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-muted">
                  {video.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={video.thumbnailUrl}
                      alt={video.title}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {video.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Статус: {video.status}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        <SheetFooter>
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              Выбрано: {pickedIds.size}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={attachSaving}
              >
                Отмена
              </Button>
              <Button
                type="button"
                onClick={() => void handleAttach()}
                disabled={attachSaving || pickedIds.size === 0}
              >
                {attachSaving ? "Добавляем..." : "Добавить"}
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
