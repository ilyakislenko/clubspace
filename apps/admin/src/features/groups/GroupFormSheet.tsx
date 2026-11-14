"use client"

import { useEffect, useState } from "react"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@clubspace/ui-kit/ui"

import {
  createGroup,
  getGroup,
  listGyms,
  updateGroup,
  type GroupDetails,
  type Gym,
} from "../../shared/api/groups"
import { fetchMe } from "../../shared/api/me"
import { listAllStaffMembers, type WorkspaceMember } from "../../shared/api/members"
import { errorMessage } from "../../shared/lib/error-message"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { isStaleUpdate, StaleUpdateNotice } from "../../shared/ui/stale-update-notice"
import { useDirectionScope } from "../../shared/workspace/use-direction-scope"
import { useDirections } from "../directions/use-directions"
import { GroupForm } from "./GroupForm"
import { isCoachCapable } from "./helpers"

type Props = {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // Set = edit this group; unset = create a new one.
  group?: GroupDetails
  onSaved: (groupId: string) => void | Promise<void>
}

/** Create / edit a group in a side panel (time is edited in the calendar). */
export function GroupFormSheet(props: Props) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{props.group ? "Изменить группу" : "Новая группа"}</SheetTitle>
          <SheetDescription>
            Группа закреплена за одним залом; помощников и учеников можно добавить в карточке группы.
          </SheetDescription>
        </SheetHeader>
        {/* Mounted only while the panel is open: halls and staff load then. */}
        <GroupFormBody {...props} />
      </SheetContent>
    </Sheet>
  )
}

function GroupFormBody({ workspaceId, onOpenChange, group, onSaved }: Props) {
  const scope = useDirectionScope(workspaceId)
  const { directions } = useDirections(workspaceId)
  const vocabulary = useVocabulary()
  const [gyms, setGyms] = useState<Gym[] | null>(null)
  const [coaches, setCoaches] = useState<WorkspaceMember[]>([])
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The group as the form opened it: its `updatedAt` goes back with the save,
  // so a page reload behind the open panel cannot hide someone else's edit.
  const [current, setCurrent] = useState(group)
  const [stale, setStale] = useState<unknown>(null)

  useEffect(() => {
    let alive = true
    void Promise.all([listGyms({ workspaceId }), listAllStaffMembers({ workspaceId })])
      .then(([g, staff]) => {
        if (!alive) return
        setGyms(g.data)
        setCoaches(staff.filter(isCoachCapable))
      })
      .catch(
        (err) =>
          alive && setError(errorMessage(err, `Не удалось загрузить залы и ${vocabulary.coach.genPl}`)),
      )
    if (scope.isDirectionManager) {
      void fetchMe()
        .then((me) => alive && setMyUserId(me.id))
        .catch(() => undefined)
    }
    return () => {
      alive = false
    }
    // vocabulary only words the message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, scope.isDirectionManager])

  // A direction manager picks among their directions — except for a group
  // they coach themselves, which their plain coach rights cover anywhere.
  const coachesIt = !!current && myUserId !== null && current.coaches.some((c) => c.userId === myUserId)
  const directionScope =
    scope.allowedDirectionIds && !coachesIt
      ? {
          allowedIds: scope.allowedDirectionIds,
          defaultDirectionId: scope.defaultDirectionId,
          ownUserId: myUserId,
        }
      : undefined

  // «Обновить» after a 409: the stored group replaces the draft.
  const reload = async () => {
    if (!current) return
    try {
      setCurrent(await getGroup({ workspaceId, groupId: current.id }))
      setStale(null)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить группу"))
    }
  }

  return (
    <>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {stale !== null && <StaleUpdateNotice error={stale} onReload={reload} />}
      {gyms === null ? (
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      ) : gyms.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {scope.isSportLead
            ? "Сначала добавьте зал на вкладке «Залы»."
            : "Попросите администратора добавить зал."}
        </p>
      ) : (
        <GroupForm
          key={current ? `${current.id}:${current.updatedAt}` : "new"}
          mode={current ? "edit" : "create"}
          workspaceId={workspaceId}
          initial={
            current && {
              name: current.name,
              gymId: current.gym?.id ?? "",
              coachId: current.coach.id,
              directionId: current.direction?.id ?? null,
              bookingMode: current.bookingMode,
              capacity: current.capacity,
              bookingWindowDays: current.bookingWindowDays,
              bookingCancelHours: current.bookingCancelHours,
            }
          }
          gyms={gyms}
          directions={directions}
          coachOptions={coaches}
          submitting={submitting}
          directionScope={directionScope}
          onCancel={() => onOpenChange(false)}
          onSubmit={async (payload) => {
            setSubmitting(true)
            setError(null)
            setStale(null)
            try {
              const saved = current
                ? await updateGroup({
                    workspaceId,
                    groupId: current.id,
                    name: payload.name,
                    gymId: payload.gymId,
                    coachId: payload.coachId,
                    directionId: payload.directionId,
                    bookingMode: payload.bookingMode,
                    capacity: payload.capacity,
                    bookingWindowDays: payload.bookingWindowDays,
                    bookingCancelHours: payload.bookingCancelHours,
                    expectedUpdatedAt: current.updatedAt,
                  })
                : await createGroup({ workspaceId, ...payload })
              onOpenChange(false)
              await onSaved(saved.id)
            } catch (err) {
              if (current && isStaleUpdate(err)) setStale(err)
              else setError(errorMessage(err, current ? "Не удалось сохранить" : "Не удалось создать группу"))
            } finally {
              setSubmitting(false)
            }
          }}
        />
      )}
    </>
  )
}
