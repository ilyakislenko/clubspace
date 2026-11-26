"use client"

import Link from "next/link"

import { type PlaylistResponse } from "../../shared/api/playlists"

type Props = {
  workspaceId: string
  playlists: PlaylistResponse[]
  loading: boolean
}

// Course rows open the course page, which holds its editing and deletion.
export function CourseList({ workspaceId, playlists, loading }: Props) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-end">
        {loading && (
          <span className="text-xs text-muted-foreground">Обновление...</span>
        )}
      </div>

      <div className="divide-y rounded-lg border border-border">
        {playlists.map((playlist) => (
          <Link
            key={playlist.id}
            href={`/workspace/${workspaceId}/content/courses/${playlist.id}`}
            className="flex min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
          >
            {playlist.thumbnailUrl ? (
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
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    Черновик
                  </span>
                )}
              </div>
              {playlist.description && (
                <div className="truncate text-xs text-muted-foreground">
                  {playlist.description}
                </div>
              )}
            </div>
          </Link>
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
