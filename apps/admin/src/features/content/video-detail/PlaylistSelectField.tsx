"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { Input, Label } from "@clubspace/ui-kit/ui"
import { Check, Search } from "lucide-react"

import { type PlaylistResponse } from "../../../shared/api/playlists"

type Props = {
  playlists: PlaylistResponse[]
  playlistsLoading: boolean
  selectedPlaylistIds: string[]
  saving: boolean
  onToggle: (playlistId: string) => void
}

export function PlaylistSelectField({
  playlists,
  playlistsLoading,
  selectedPlaylistIds,
  saving,
  onToggle,
}: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      const target = event.target as Node
      if (ref.current && !ref.current.contains(target)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const filteredPlaylists = useMemo(() => {
    if (!search.trim()) return playlists
    const query = search.toLowerCase()
    return playlists.filter((playlist) =>
      playlist.title.toLowerCase().includes(query),
    )
  }, [playlists, search])

  return (
    <div className="space-y-2" ref={ref}>
      <Label>Плейлисты</Label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        >
          <span className="truncate text-left">
            {selectedPlaylistIds.length
              ? playlists
                  .filter((playlist) =>
                    selectedPlaylistIds.includes(playlist.id),
                  )
                  .map((playlist) => playlist.title)
                  .join(", ")
              : "Выберите плейлист"}
          </span>
          <span className="ml-2 shrink-0 text-xs text-muted-foreground">
            {saving ? "Сохраняем..." : "Выбрать"}
          </span>
        </button>

        {open && (
          <div className="absolute z-10 mt-2 w-full rounded-md border border-border bg-background p-3 shadow-lg">
            <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Введите название плейлиста"
                className="h-7 border-none px-0 text-sm focus-visible:ring-0"
              />
            </div>
            <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
              {playlistsLoading && (
                <div className="text-xs text-muted-foreground">
                  Загружаем плейлисты...
                </div>
              )}
              {!playlistsLoading && filteredPlaylists.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  Плейлисты не найдены.
                </div>
              )}
              {filteredPlaylists.map((playlist) => {
                const checked = selectedPlaylistIds.includes(playlist.id)
                return (
                  <button
                    key={playlist.id}
                    type="button"
                    onClick={() => onToggle(playlist.id)}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded border border-border">
                      {checked && <Check className="h-4 w-4" />}
                    </span>
                    <span className="text-sm">{playlist.title}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
