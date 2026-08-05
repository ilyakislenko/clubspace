"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@clubspace/ui-kit/ui"
import { ChevronDown, Plus } from "lucide-react"

import { CourseList } from "../../../../../features/content/CourseList"
import { PlaylistFormSheet } from "../../../../../features/content/PlaylistFormSheet"
import { VideoList } from "../../../../../features/content/VideoList"
import { VideoUploadSheet } from "../../../../../features/content/VideoUploadSheet"
import {
  listCategories,
  type CategoryResponse,
} from "../../../../../shared/api/categories"
import {
  deletePlaylist,
  listPlaylists,
  type PlaylistResponse,
} from "../../../../../shared/api/playlists"
import { listTags, type TagResponse } from "../../../../../shared/api/tags"

export default function WorkspaceContentPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [activeTab, setActiveTab] = useState<"videos" | "courses">("videos")

  // Workspace-level lists shared across the screen: the upload sheet selects /
  // appends to tags + categories, and both the courses tab and the upload sheet
  // read playlists. Loaded once on mount.
  const [playlists, setPlaylists] = useState<PlaylistResponse[]>([])
  const [playlistsLoading, setPlaylistsLoading] = useState(false)
  const [tags, setTags] = useState<TagResponse[]>([])
  const [tagsLoading, setTagsLoading] = useState(false)
  const [categories, setCategories] = useState<CategoryResponse[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(false)

  const [uploadOpen, setUploadOpen] = useState(false)
  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false)
  const [editPlaylist, setEditPlaylist] = useState<PlaylistResponse | null>(null)

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

  const loadTags = async () => {
    if (!workspaceId) return
    setTagsLoading(true)
    try {
      const response = await listTags({ workspaceId })
      setTags(response.data)
    } finally {
      setTagsLoading(false)
    }
  }

  const loadCategories = async () => {
    if (!workspaceId) return
    setCategoriesLoading(true)
    try {
      const response = await listCategories({ workspaceId })
      setCategories(response.data)
    } finally {
      setCategoriesLoading(false)
    }
  }

  useEffect(() => {
    void loadPlaylists()
    void loadTags()
    void loadCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const handleDeletePlaylist = async (playlist: PlaylistResponse) => {
    if (!workspaceId) return
    const confirmed = window.confirm("Удалить плейлист?")
    if (!confirmed) return

    try {
      await deletePlaylist({ workspaceId, playlistId: playlist.id })
      setPlaylists((prev) => prev.filter((item) => item.id !== playlist.id))
    } catch {
      // Surface the failure instead of swallowing it (the row stays in the DB).
      window.alert("Не удалось удалить плейлист. Попробуйте ещё раз.")
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Контент</h1>
          <p className="text-sm text-muted-foreground">
            Видео и курсы воркспейса.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" className="gap-2">
              <Plus className="size-4" />
              Создать
              <ChevronDown className="size-4 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => setUploadOpen(true)}>
              Загрузить видео
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setCreatePlaylistOpen(true)}>
              Новый курс
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-2 border-b border-border">
        {(
          [
            { id: "videos" as const, label: "Видео" },
            { id: "courses" as const, label: "Курсы" },
          ]
        ).map((tab) => {
          const active = tab.id === activeTab
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative -mb-px px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === "videos" && workspaceId && (
        <VideoList workspaceId={workspaceId} />
      )}

      {activeTab === "courses" && workspaceId && (
        <CourseList
          workspaceId={workspaceId}
          playlists={playlists}
          loading={playlistsLoading}
          onEdit={setEditPlaylist}
          onDelete={handleDeletePlaylist}
        />
      )}

      {workspaceId && (
        <>
          <VideoUploadSheet
            workspaceId={workspaceId}
            open={uploadOpen}
            onOpenChange={setUploadOpen}
            playlists={playlists}
            tags={tags}
            categories={categories}
            tagsLoading={tagsLoading}
            categoriesLoading={categoriesLoading}
            onTagCreated={(tag) => setTags((prev) => [...prev, tag])}
            onCategoryCreated={(category) =>
              setCategories((prev) => [...prev, category])
            }
          />

          <PlaylistFormSheet
            mode="create"
            workspaceId={workspaceId}
            open={createPlaylistOpen}
            onOpenChange={setCreatePlaylistOpen}
            onSaved={(playlist) => setPlaylists((prev) => [playlist, ...prev])}
          />

          <PlaylistFormSheet
            mode="edit"
            workspaceId={workspaceId}
            open={Boolean(editPlaylist)}
            playlist={editPlaylist}
            onOpenChange={(open) => {
              if (!open) setEditPlaylist(null)
            }}
            onSaved={(playlist) =>
              setPlaylists((prev) =>
                prev.map((item) => (item.id === playlist.id ? playlist : item)),
              )
            }
          />
        </>
      )}
    </div>
  )
}
