"use client"

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"

import { Button, Input, Label, Textarea } from "@clubspace/ui-kit/ui"

import { getClubAbout, updateClubAbout } from "../../shared/api/club-about"
import { errorMessage } from "../../shared/lib/error-message"
import {
  draftToInput,
  MAX_ITEMS,
  moveItem,
  validateClubAboutDraft,
  type ClubAboutDraft,
} from "./club-about-form"

const EMPTY: ClubAboutDraft = { contacts: [], links: [], rules: "" }

export function ClubAboutSection({ workspaceId }: { workspaceId: string }) {
  const [draft, setDraft] = useState<ClubAboutDraft>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // Saving replaces the whole page, so a form that failed to load must not be
  // editable — saving the empty draft would wipe what is stored.
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setLoadFailed(false)
    void (async () => {
      try {
        const data = await getClubAbout({ workspaceId })
        if (cancelled) return
        setDraft({
          contacts: data.contacts,
          links: data.links,
          rules: data.rules ?? "",
        })
      } catch (err) {
        if (!cancelled) {
          setLoadFailed(true)
          setError(errorMessage(err, "Не удалось загрузить информацию о клубе"))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspaceId, reloadKey])

  const edit = (next: ClubAboutDraft) => {
    setDraft(next)
    setSaved(false)
  }

  const handleSave = async () => {
    const problem = validateClubAboutDraft(draft)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const data = await updateClubAbout({
        workspaceId,
        data: draftToInput(draft),
      })
      // The server stores phones normalised (+7…); show what was saved.
      setDraft({
        contacts: data.contacts,
        links: data.links,
        rules: data.rules ?? "",
      })
      setSaved(true)
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="font-medium">О клубе</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Видно ученикам в приложении: Профиль → О клубе
      </p>

      {loading ? (
        <div className="mt-4 h-24 animate-pulse rounded-lg border border-border bg-muted" />
      ) : loadFailed ? (
        <div className="mt-4 space-y-3">
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            Повторить
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          <div className="space-y-2">
            <Label>Контакты</Label>
            {draft.contacts.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input
                  value={c.label}
                  placeholder="Например, Главный тренер"
                  maxLength={120}
                  className="h-9 min-w-[160px] flex-1"
                  onChange={(e) =>
                    edit({
                      ...draft,
                      contacts: draft.contacts.map((x, j) =>
                        j === i ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                />
                <Input
                  value={c.phone}
                  placeholder="+7 952 884-94-20"
                  maxLength={32}
                  className="h-9 w-[180px]"
                  onChange={(e) =>
                    edit({
                      ...draft,
                      contacts: draft.contacts.map((x, j) =>
                        j === i ? { ...x, phone: e.target.value } : x,
                      ),
                    })
                  }
                />
                <RowActions
                  index={i}
                  count={draft.contacts.length}
                  onMove={(delta) =>
                    edit({
                      ...draft,
                      contacts: moveItem(draft.contacts, i, delta),
                    })
                  }
                  onRemove={() =>
                    edit({
                      ...draft,
                      contacts: draft.contacts.filter((_, j) => j !== i),
                    })
                  }
                />
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={draft.contacts.length >= MAX_ITEMS}
              onClick={() =>
                edit({
                  ...draft,
                  contacts: [...draft.contacts, { label: "", phone: "" }],
                })
              }
            >
              <Plus className="mr-1 size-4" /> Добавить контакт
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Ссылки</Label>
            {draft.links.map((l, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input
                  value={l.label}
                  placeholder="Например, Сайт"
                  maxLength={60}
                  className="h-9 min-w-[160px] flex-1"
                  onChange={(e) =>
                    edit({
                      ...draft,
                      links: draft.links.map((x, j) =>
                        j === i ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                />
                <Input
                  value={l.url}
                  placeholder="https://"
                  maxLength={500}
                  className="h-9 min-w-[200px] flex-[2]"
                  onChange={(e) =>
                    edit({
                      ...draft,
                      links: draft.links.map((x, j) =>
                        j === i ? { ...x, url: e.target.value } : x,
                      ),
                    })
                  }
                />
                <RowActions
                  index={i}
                  count={draft.links.length}
                  onMove={(delta) =>
                    edit({ ...draft, links: moveItem(draft.links, i, delta) })
                  }
                  onRemove={() =>
                    edit({
                      ...draft,
                      links: draft.links.filter((_, j) => j !== i),
                    })
                  }
                />
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={draft.links.length >= MAX_ITEMS}
              onClick={() =>
                edit({
                  ...draft,
                  links: [...draft.links, { label: "", url: "" }],
                })
              }
            >
              <Plus className="mr-1 size-4" /> Добавить ссылку
            </Button>
          </div>

          <div className="space-y-1">
            <Label>Правила клуба</Label>
            <Textarea
              value={draft.rules}
              rows={8}
              maxLength={10000}
              placeholder="Абзацы разделяйте пустой строкой"
              onChange={(e) => edit({ ...draft, rules: e.target.value })}
            />
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {saved && <p className="text-sm text-muted-foreground">Сохранено</p>}

          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? "Сохраняем..." : "Сохранить"}
          </Button>
        </div>
      )}
    </div>
  )
}

function RowActions({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number
  count: number
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Выше"
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUp className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Ниже"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDown className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Удалить"
        onClick={onRemove}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  )
}
