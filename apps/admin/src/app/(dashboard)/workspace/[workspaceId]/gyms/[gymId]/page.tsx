"use client"

import { MoreHorizontal } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@clubspace/ui-kit/ui"

import { GroupRows } from "../../../../../../features/groups/GroupRows"
import { GymFormSheet } from "../../../../../../features/groups/GymFormSheet"
import {
  deleteGym,
  listGroups,
  listGyms,
  type GroupSummary,
  type Gym,
} from "../../../../../../shared/api/groups"
import { errorMessage } from "../../../../../../shared/lib/error-message"
import { pluralRu } from "../../../../../../shared/lib/plural-ru"
import { confirmDialog } from "../../../../../../shared/ui/confirm-dialog"
import { useDirectionScope } from "../../../../../../shared/workspace/use-direction-scope"

// The gym card: address and settings, and its groups read-only (each opens
// its own card; rosters live there).
export default function WorkspaceGymPage() {
  const params = useParams<{ workspaceId: string; gymId: string }>()
  const workspaceId = params?.workspaceId
  const gymId = params?.gymId
  const router = useRouter()
  const canEdit = useDirectionScope(workspaceId).isSportLead

  const [gym, setGym] = useState<Gym | null>(null)
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    if (!workspaceId || !gymId) return
    try {
      const [gymsResp, groupsResp] = await Promise.all([listGyms({ workspaceId }), listGroups({ workspaceId })])
      setGym(gymsResp.data.find((g) => g.id === gymId) ?? null)
      setGroups(groupsResp.data.filter((g) => g.gym?.id === gymId))
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить зал"))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, gymId])

  useEffect(() => {
    void load()
  }, [load])

  const backLink = (
    <Link href={`/workspace/${workspaceId}/groups?tab=gyms`} className="text-xs text-muted-foreground hover:underline">
      ← Группы и залы
    </Link>
  )

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg border border-border bg-muted/50" />
      </div>
    )
  }

  if (error || !gym || !workspaceId) {
    return (
      <div className="space-y-4">
        {backLink}
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ?? "Зал не найден"}
        </p>
      </div>
    )
  }

  const students = groups.reduce((acc, g) => acc + g.memberCount, 0)

  const handleDelete = async () => {
    if (
      !(await confirmDialog({
        title: `Удалить зал «${gym.name}»?`,
        description:
          groups.length > 0
            ? `${groups.length} ${pluralRu(groups.length, "группа останется", "группы останутся", "групп останутся")} без зала — их можно будет перенести в другой.`
            : undefined,
        confirmLabel: "Удалить зал",
        destructive: true,
      }))
    ) {
      return
    }
    setDeleting(true)
    try {
      await deleteGym({ workspaceId, gymId: gym.id })
      router.push(`/workspace/${workspaceId}/groups?tab=gyms`)
    } catch (err) {
      setError(errorMessage(err, "Не удалось удалить зал"))
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="space-y-2">
        {backLink}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold">{gym.name}</h1>
          {canEdit && (
            <div className="flex shrink-0 items-center gap-1">
              <Button type="button" onClick={() => setEditOpen(true)}>
                Изменить
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label="Ещё" disabled={deleting}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-destructive" onSelect={() => void handleDelete()}>
                    Удалить зал
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem,1fr]">
        <dt className="text-muted-foreground">Адрес</dt>
        <dd>{gym.address}</dd>
        <dt className="text-muted-foreground">Часовой пояс</dt>
        <dd>{gym.timezone ?? "Как у клуба"}</dd>
        <dt className="text-muted-foreground">Учеников в группах</dt>
        <dd className="tabular-nums">{students}</dd>
      </dl>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          {groups.length} {pluralRu(groups.length, "группа", "группы", "групп")} в зале
        </h2>
        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            В этом зале пока нет групп. Зал выбирается в карточке группы.
          </p>
        ) : (
          <GroupRows workspaceId={workspaceId} groups={groups} showGym={false} />
        )}
      </section>

      <GymFormSheet
        workspaceId={workspaceId}
        open={editOpen}
        onOpenChange={setEditOpen}
        gym={gym}
        onSaved={load}
      />
    </div>
  )
}
