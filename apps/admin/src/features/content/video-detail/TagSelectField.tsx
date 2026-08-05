"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { Input, Label } from "@clubspace/ui-kit/ui"
import { Check, Plus, Search, X } from "lucide-react"

import { type TagResponse } from "../../../shared/api/tags"

type Props = {
  tags: TagResponse[]
  tagsLoading: boolean
  selectedTagIds: string[]
  saving: boolean
  onToggle: (tagId: string) => void
}

export function TagSelectField({
  tags,
  tagsLoading,
  selectedTagIds,
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

  const filteredTags = useMemo(() => {
    if (!search.trim()) return tags
    const query = search.toLowerCase()
    return tags.filter((tag) => tag.name.toLowerCase().includes(query))
  }, [tags, search])

  const selectedTags = useMemo(
    () => tags.filter((tag) => selectedTagIds.includes(tag.id)),
    [tags, selectedTagIds],
  )

  return (
    <div className="space-y-2" ref={ref}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Label className="text-sm font-medium">Теги</Label>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-label="Добавить тег"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        {saving && (
          <span className="text-xs text-muted-foreground">Сохраняем...</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {selectedTags.length === 0 && (
          <span className="text-xs text-muted-foreground">
            Теги не добавлены.
          </span>
        )}
        {selectedTags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs"
          >
            {tag.name}
            <button
              type="button"
              onClick={() => onToggle(tag.id)}
              aria-label={`Удалить тег ${tag.name}`}
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-muted"
              disabled={saving}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      {open && (
        <div className="relative">
          <div className="absolute z-10 mt-1 w-full max-w-md rounded-md border border-border bg-background p-3 shadow-lg">
            <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск тегов"
                className="h-7 border-none px-0 text-sm focus-visible:ring-0"
              />
            </div>
            <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
              {tagsLoading && (
                <div className="text-xs text-muted-foreground">
                  Загружаем теги...
                </div>
              )}
              {!tagsLoading && filteredTags.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  Теги не найдены.
                </div>
              )}
              {filteredTags.map((tag) => {
                const checked = selectedTagIds.includes(tag.id)
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => onToggle(tag.id)}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded border border-border">
                      {checked && <Check className="h-4 w-4" />}
                    </span>
                    <span className="flex-1 text-sm">{tag.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {tag.type}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
