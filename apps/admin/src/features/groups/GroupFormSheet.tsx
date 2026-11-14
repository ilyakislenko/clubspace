"use client"

import { useEffect, useState } from "react"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@clubspace/ui-kit/ui"

import { createGroup, listGyms, updateGroup, type GroupDetails, type Gym } from "../../shared/api/groups"
import { fetchMe } from "../../shared/api/me"
import { listAllStaffMembers, type WorkspaceMember } from "../../shared/api/members"
import { errorMessage } from "../../shared/lib/error-message"
import { useVocabulary } from "../../shared/lib/vocabulary"
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
  const coachesIt = !!group && myUserId !== null && group.coaches.some((c) => c.userId === myUserId)
  const directionScope =
    scope.allowedDirectionIds && !coachesIt
      ? {
          allowedIds: scope.allowedDirectionIds,
          defaultDirectionId: scope.defaultDirectionId,
          ownUserId: myUserId,
        }
      : undefined

  return (
    <>
      {error && <p className="text-sm text-destructive">{error}</p>}
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
          key={group?.id ?? "new"}
          mode={group ? "edit" : "create"}
          workspaceId={workspaceId}
          initial={
            group && {
              name: group.name,
              gymId: group.gym?.id ?? "",
              coachId: group.coach.id,
              directionId: group.direction?.id ?? null,
              bookingMode: group.bookingMode,
              capacity: group.capacity,
              bookingWindowDays: group.bookingWindowDays,
              bookingCancelHours: group.bookingCancelHours,
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
            try {
              const saved = group
                ? await updateGroup({
                    workspaceId,
                    groupId: group.id,
                    name: payload.name,
                    gymId: payload.gymId,
                    coachId: payload.coachId,
                    directionId: payload.directionId,
                    bookingMode: payload.bookingMode,
                    capacity: payload.capacity,
                    bookingWindowDays: payload.bookingWindowDays,
                    bookingCancelHours: payload.bookingCancelHours,
                  })
                : await createGroup({ workspaceId, ...payload })
              onOpenChange(false)
              await onSaved(saved.id)
            } catch (err) {
              setError(errorMessage(err, group ? "Не удалось сохранить" : "Не удалось создать группу"))
            } finally {
              setSubmitting(false)
            }
          }}
        />
      )}
    </>
  )
}
