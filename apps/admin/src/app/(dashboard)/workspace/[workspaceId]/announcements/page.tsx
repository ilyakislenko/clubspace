"use client"

import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@bjj-academy/ui-kit/ui"

import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  type Announcement,
} from "../../../../../shared/api/announcements"
import { errorMessage } from "../../../../../shared/lib/error-message"

const inputCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"

export default function WorkspaceAnnouncementsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [items, setItems] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      const res = await listAnnouncements({ workspaceId })
      setItems(res.data)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить объявления"))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async (publish: boolean) => {
    if (!workspaceId || !title.trim() || !body.trim()) return
    setBusy(true)
    try {
      await createAnnouncement({
        workspaceId,
        data: { title: title.trim(), body: body.trim(), pinned, publish },
      })
      setTitle("")
      setBody("")
      setPinned(false)
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось сохранить объявление"))
    } finally {
      setBusy(false)
    }
  }

  const wrap = (fn: () => Promise<unknown>) => async () => {
    if (!workspaceId) return
    try {
      await fn()
      await load()
    } catch (e) {
      setError(errorMessage(e, "Ошибка"))
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Объявления</h1>
        <p className="text-sm text-muted-foreground">
          Лента клуба. Опубликованные объявления видят все участники; черновики —
          только персонал. Закреплённые всплывают наверх.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-2 rounded-xl border border-border bg-card/40 p-4">
        <input
          className={inputCls}
          placeholder="Заголовок"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className={`${inputCls} min-h-24`}
          placeholder="Текст объявления"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
            />
            Закрепить
          </label>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              disabled={busy || !title.trim() || !body.trim()}
              onClick={() => void submit(false)}
            >
              В черновик
            </Button>
            <Button
              disabled={busy || !title.trim() || !body.trim()}
              onClick={() => void submit(true)}
            >
              Опубликовать
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Объявлений пока нет.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id} className="rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{a.title}</span>
                    {a.pinned && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                        Закреплено
                      </span>
                    )}
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] ${
                        a.publishedAt
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {a.publishedAt ? "Опубликовано" : "Черновик"}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {a.body}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.authorName}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={wrap(() =>
                    updateAnnouncement({
                      workspaceId: workspaceId!,
                      announcementId: a.id,
                      data: { publish: !a.publishedAt },
                    }),
                  )}
                >
                  {a.publishedAt ? "В черновик" : "Опубликовать"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={wrap(() =>
                    updateAnnouncement({
                      workspaceId: workspaceId!,
                      announcementId: a.id,
                      data: { pinned: !a.pinned },
                    }),
                  )}
                >
                  {a.pinned ? "Открепить" : "Закрепить"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={wrap(async () => {
                    if (!window.confirm("Удалить объявление?")) return
                    await deleteAnnouncement({
                      workspaceId: workspaceId!,
                      announcementId: a.id,
                    })
                  })}
                >
                  Удалить
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
