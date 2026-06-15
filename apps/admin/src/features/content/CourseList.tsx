"use client"

import { useRouter } from "next/navigation"

import { Button } from "@bjj-academy/ui-kit/ui"

import { type PlaylistResponse } from "../../shared/api/playlists"

type Props = {
  workspaceId: string
  playlists: PlaylistResponse[]
  loading: boolean
  onEdit: (playlist: PlaylistResponse) => void
  onDelete: (playlist: PlaylistResponse) => void
}

export function CourseList({
  workspaceId,
  playlists,
  loading,
  onEdit,
  onDelete,
}: Props) {
  const router = useRouter()

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-end">
        {loading && (
          <span className="text-xs text-muted-foreground">Обновление...</span>
        )}
      </div>

      <div className="divide-y rounded-lg border border-border">
        {playlists.map((playlist) => (
          <div
            key={playlist.id}
            className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
          >
            <button
              type="button"
              onClick={() =>
                router.push(
                  `/workspace/${workspaceId}/content/courses/${playlist.id}`,
                )
              }
              className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80"
            >
              {playlist.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={playlist.thumbnailUrl}
                  alt={playlist.title}
                  className="h-12 w-20 rounded-md border border-border object-cover"
                />
              ) : (
                <div className="flex h-12 w-20 items-center justify-center rounded-md border border-dashed border-border text-[10px] text-muted-foreground">
                  Нет превью
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{playlist.title}</span>
                  {!playlist.isPublic && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Черновик
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {playlist.slug}
                </div>
              </div>
            </button>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                type="button"
                onClick={() => onEdit(playlist)}
              >
                Редактировать
              </Button>
              <Button
                variant="destructive"
                type="button"
                onClick={() => onDelete(playlist)}
              >
                Удалить
              </Button>
            </div>
          </div>
        ))}
        {playlists.length === 0 && !loading && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Курсов пока нет.
          </p>
        )}
      </div>
    </section>
  )
}
