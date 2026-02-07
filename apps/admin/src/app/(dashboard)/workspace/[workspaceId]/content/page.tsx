"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"

import { Button, Input, Label } from "@bjj-academy/ui-kit/ui"
import {
  completeVideoUpload,
  createVideoUpload,
  getVideo,
} from "../../../../../shared/api/videos"
import {
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  updatePlaylist,
  type PlaylistResponse,
} from "../../../../../shared/api/playlists"

export default function WorkspaceContentPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [videoTitle, setVideoTitle] = useState("")
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [uploadState, setUploadState] = useState<{
    status: "idle" | "uploading" | "processing" | "ready" | "error"
    message?: string
    videoId?: string
  }>({ status: "idle" })

  const [playlistTitle, setPlaylistTitle] = useState("")
  const [playlistSlug, setPlaylistSlug] = useState("")
  const [playlistTags, setPlaylistTags] = useState("")
  const [playlists, setPlaylists] = useState<PlaylistResponse[]>([])
  const [playlistsLoading, setPlaylistsLoading] = useState(false)

  const canUpload = useMemo(
    () => Boolean(workspaceId && videoTitle.trim() && videoFile),
    [workspaceId, videoTitle, videoFile]
  )

  const loadPlaylists = async () => {
    if (!workspaceId) return
    setPlaylistsLoading(true)
    try {
      const response = await listPlaylists({ workspaceId })
      setPlaylists(response.data)
    } finally {
      setPlaylistsLoading(false)
    }
  }

  useEffect(() => {
    void loadPlaylists()
  }, [workspaceId])

  const handleUpload = async () => {
    if (!workspaceId || !videoFile) return

    setUploadState({ status: "uploading", message: "Получаем URL загрузки..." })

    try {
      const createResponse = await createVideoUpload({
        workspaceId,
        title: videoTitle,
        contentType: videoFile.type || "video/mp4",
      })

      await fetch(createResponse.upload.url, {
        method: "PUT",
        headers: {
          "Content-Type": videoFile.type || "video/mp4",
        },
        body: videoFile,
      })

      setUploadState({
        status: "processing",
        message: "Файл загружен, ставим в очередь...",
        videoId: createResponse.videoId,
      })

      await completeVideoUpload({
        workspaceId,
        videoId: createResponse.videoId,
      })

      setUploadState({
        status: "processing",
        message: "Видео в очереди обработки",
        videoId: createResponse.videoId,
      })

      const details = await getVideo({
        workspaceId,
        videoId: createResponse.videoId,
      })

      setUploadState({
        status: details.status === "ready" ? "ready" : "processing",
        message: `Статус видео: ${details.status}`,
        videoId: createResponse.videoId,
      })
    } catch (error) {
      setUploadState({
        status: "error",
        message: error instanceof Error ? error.message : "Ошибка загрузки",
      })
    }
  }

  const handleCreatePlaylist = async () => {
    if (!workspaceId || !playlistTitle.trim() || !playlistSlug.trim()) {
      return
    }

    const tags = playlistTags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)

    const playlist = await createPlaylist({
      workspaceId,
      data: {
        title: playlistTitle,
        slug: playlistSlug,
        tags,
      },
    })

    setPlaylists((prev) => [playlist, ...prev])
    setPlaylistTitle("")
    setPlaylistSlug("")
    setPlaylistTags("")
  }

  const handleRenamePlaylist = async (playlist: PlaylistResponse) => {
    if (!workspaceId) return
    const nextTitle = window.prompt("Новое название плейлиста", playlist.title)
    if (!nextTitle) return

    const updated = await updatePlaylist({
      workspaceId,
      playlistId: playlist.id,
      data: { title: nextTitle },
    })

    setPlaylists((prev) =>
      prev.map((item) => (item.id === playlist.id ? updated : item))
    )
  }

  const handleDeletePlaylist = async (playlist: PlaylistResponse) => {
    if (!workspaceId) return
    const confirmed = window.confirm("Удалить плейлист?")
    if (!confirmed) return

    await deletePlaylist({ workspaceId, playlistId: playlist.id })
    setPlaylists((prev) => prev.filter((item) => item.id !== playlist.id))
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Контент</h1>
        <p className="text-sm text-muted-foreground">
          Видео и плейлисты воркспейса.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">Загрузка видео</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="video-title">Название</Label>
            <Input
              id="video-title"
              value={videoTitle}
              onChange={(event) => setVideoTitle(event.target.value)}
              placeholder="Например, Guard retention basics"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="video-file">Файл (mp4)</Label>
            <Input
              id="video-file"
              type="file"
              accept="video/mp4,video/quicktime,video/x-m4v"
              onChange={(event) => {
                setVideoFile(event.target.files?.[0] ?? null)
              }}
            />
          </div>
        </div>
        <Button
          type="button"
          disabled={!canUpload || uploadState.status === "uploading"}
          onClick={handleUpload}
        >
          Загрузить
        </Button>
        {uploadState.message && (
          <p className="text-sm text-muted-foreground">
            {uploadState.message}
          </p>
        )}
      </section>

      <section className="space-y-4 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Плейлисты</h2>
          {playlistsLoading && (
            <span className="text-xs text-muted-foreground">Обновление...</span>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="playlist-title">Название</Label>
            <Input
              id="playlist-title"
              value={playlistTitle}
              onChange={(event) => setPlaylistTitle(event.target.value)}
              placeholder="Closed Guard"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="playlist-slug">Slug</Label>
            <Input
              id="playlist-slug"
              value={playlistSlug}
              onChange={(event) => setPlaylistSlug(event.target.value)}
              placeholder="closed-guard"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="playlist-tags">Теги (через запятую)</Label>
            <Input
              id="playlist-tags"
              value={playlistTags}
              onChange={(event) => setPlaylistTags(event.target.value)}
              placeholder="guard, fundamentals"
            />
          </div>
        </div>

        <Button type="button" onClick={handleCreatePlaylist}>
          Создать плейлист
        </Button>

        <div className="divide-y">
          {playlists.map((playlist) => (
            <div
              key={playlist.id}
              className="flex flex-wrap items-center justify-between gap-4 py-3"
            >
              <div>
                <div className="font-medium">{playlist.title}</div>
                <div className="text-xs text-muted-foreground">
                  {playlist.slug}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => handleRenamePlaylist(playlist)}
                >
                  Переименовать
                </Button>
                <Button
                  variant="destructive"
                  type="button"
                  onClick={() => handleDeletePlaylist(playlist)}
                >
                  Удалить
                </Button>
              </div>
            </div>
          ))}
          {playlists.length === 0 && !playlistsLoading && (
            <p className="py-4 text-sm text-muted-foreground">
              Плейлистов пока нет.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
