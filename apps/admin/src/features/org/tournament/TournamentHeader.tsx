"use client"

import { ChevronLeft } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@clubspace/ui-kit/ui"

import {
  publishOrgTournamentResults,
  setOrgTournamentStatus,
  updateOrgTournament,
  type OrgTournament,
} from "../../../shared/api/tournaments"
import { FORM_LIMITS } from "../../../shared/lib/contract-limits"
import { errorMessage } from "../../../shared/lib/error-message"
import { useVocabulary } from "../../../shared/lib/vocabulary"
import { confirmDialog } from "../../../shared/ui/confirm-dialog"
import { StaleUpdateNotice, isStaleUpdate } from "../../../shared/ui/stale-update-notice"
import { eventWhen } from "../org-view"
import {
  divisionsCount,
  matsCount,
  primaryAction,
  secondaryAction,
  startConfirmText,
  statusLine,
  type TournamentAction,
} from "./tournament-view"

const L = FORM_LIMITS.tournament

// Title, date and one status line; one filled button per status and the
// rare step back as a quiet one (design §7). The mats count is the admin's
// to edit.
export function TournamentHeader({
  tournament,
  isAdmin,
  onChanged,
  onReload,
}: {
  tournament: OrgTournament
  isAdmin: boolean
  onChanged: (next: OrgTournament) => void
  onReload: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingMats, setEditingMats] = useState(false)
  const t = tournament
  const vocabulary = useVocabulary()
  const primary = primaryAction(t, isAdmin)
  const secondary = secondaryAction(t, isAdmin)
  const ids = { organizationId: t.organizationId, tournamentId: t.id }

  const confirmFor = async (action: TournamentAction): Promise<boolean> => {
    switch (action) {
      case "WEIGH_IN":
        return confirmDialog({
          title: "Начать взвешивание?",
          description: "Клубы больше не смогут подавать и менять заявки — изменения только через секретаря турнира.",
          confirmLabel: "Начать взвешивание",
        })
      case "RUNNING":
        return confirmDialog({ title: "Начать турнир?", description: startConfirmText(t), confirmLabel: "Начать турнир" })
      case "SETUP":
        return confirmDialog({
          title: "Вернуть приём заявок?",
          description: "Клубы снова смогут подавать и менять заявки. Записанный вес сохранится.",
          confirmLabel: "Вернуть приём заявок",
        })
      case "publish":
        return confirmDialog({
          title: "Опубликовать итоги?",
          description:
            "Места увидят участники и клубы федерации, призёры появятся в реестре поясов. Исправить результат можно будет, сняв публикацию.",
          confirmLabel: "Опубликовать",
        })
      case "unpublish":
        return confirmDialog({
          title: "Снять публикацию?",
          description: "Места исчезнут из приложения и реестра, пока итоги не опубликуют снова.",
          confirmLabel: "Снять публикацию",
          destructive: true,
        })
    }
  }

  const act = async (action: TournamentAction) => {
    if (!(await confirmFor(action))) return
    setBusy(true)
    setError(null)
    try {
      const next =
        action === "publish" || action === "unpublish"
          ? await publishOrgTournamentResults({ ...ids, published: action === "publish" })
          : await setOrgTournamentStatus({ ...ids, status: action })
      onChanged(next)
    } catch (e) {
      setError(errorMessage(e, "Не удалось изменить этап турнира"))
    } finally {
      setBusy(false)
    }
  }

  // Nothing to weigh before the divisions exist: the phase button waits quietly.
  const primaryQuiet = t.status === "SETUP" && t.counts.divisions === 0

  return (
    <div className="space-y-3">
      <Link
        href={`/org/${t.organizationId}/events`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Календарь
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold">{t.event.title}</h1>
          <p className="text-sm text-muted-foreground">
            {eventWhen(t.event.startAt, t.event.endAt, t.event.timezone)}
            {" · "}
            {isAdmin && t.status !== "FINISHED" ? (
              <button
                type="button"
                className="underline decoration-dotted underline-offset-4 hover:text-foreground"
                onClick={() => setEditingMats(true)}
              >
                {matsCount(t.matCount)}
              </button>
            ) : (
              matsCount(t.matCount)
            )}
            {" · "}
            {divisionsCount(t.counts.divisions)}
          </p>
          <p className="text-sm font-medium">{statusLine(t, vocabulary)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {secondary && (
            <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => void act(secondary.action)}>
              {secondary.label}
            </Button>
          )}
          {primary && (
            <Button
              type="button"
              variant={primaryQuiet ? "outline" : "default"}
              className="h-11"
              disabled={busy}
              onClick={() => void act(primary.action)}
            >
              {primary.label}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {editingMats && (
        <MatsDialog
          tournament={t}
          onClose={() => setEditingMats(false)}
          onSaved={(next) => {
            setEditingMats(false)
            onChanged(next)
          }}
          onReload={onReload}
        />
      )}
    </div>
  )
}

// «Ковров: N» — how many tables run at once (admin; the version it opened with).
function MatsDialog({
  tournament,
  onClose,
  onSaved,
  onReload,
}: {
  tournament: OrgTournament
  onClose: () => void
  onSaved: (next: OrgTournament) => void
  onReload: () => Promise<void>
}) {
  const [version] = useState(tournament.updatedAt)
  const [raw, setRaw] = useState(String(tournament.matCount))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const n = /^\d+$/.test(raw.trim()) ? Number(raw) : NaN
  const valid = Number.isInteger(n) && n >= L.matCount.min && n <= L.matCount.max

  const save = async () => {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      onSaved(
        await updateOrgTournament({
          organizationId: tournament.organizationId,
          tournamentId: tournament.id,
          matCount: n,
          expectedUpdatedAt: version,
        }),
      )
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ковры</DialogTitle>
          <DialogDescription>Сколько ковров работает одновременно.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="mat-count">Ковров</Label>
            <Input id="mat-count" inputMode="numeric" className="h-12" value={raw} onChange={(e) => setRaw(e.target.value)} />
            {!valid && (
              <p className="text-sm text-destructive">
                От {L.matCount.min} до {L.matCount.max}
              </p>
            )}
          </div>
          {error !== null &&
            (isStaleUpdate(error) ? (
              <StaleUpdateNotice
                error={error}
                onReload={async () => {
                  await onReload()
                  onClose()
                }}
              />
            ) : (
              <p className="text-sm text-destructive">{errorMessage(error, "Не удалось сохранить")}</p>
            ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={!valid || busy}>
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
