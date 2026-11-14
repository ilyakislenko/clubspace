"use client"

import { useState } from "react"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@clubspace/ui-kit/ui"

import { createGym, updateGym, type Gym } from "../../shared/api/groups"
import { errorMessage } from "../../shared/lib/error-message"
import { GymForm } from "./GymForm"

type Props = {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // Set = edit this hall; unset = add a new one.
  gym?: Pick<Gym, "id" | "name" | "address" | "timezone">
  onSaved: () => void | Promise<void>
}

/** Add / edit a hall in a side panel. */
export function GymFormSheet({ workspaceId, open, onOpenChange, gym, onSaved }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null)
        onOpenChange(next)
      }}
    >
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{gym ? "Изменить зал" : "Новый зал"}</SheetTitle>
          <SheetDescription>Группы закрепляются за залом; адрес видят ученики.</SheetDescription>
        </SheetHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {open && (
          <GymForm
            key={gym?.id ?? "new"}
            initial={
              gym && {
                name: gym.name,
                address: gym.address,
                timezone: gym.timezone,
              }
            }
            submitting={submitting}
            submitLabel={gym ? "Сохранить" : "Добавить зал"}
            onCancel={() => onOpenChange(false)}
            onSubmit={async (payload) => {
              setSubmitting(true)
              setError(null)
              try {
                if (gym) await updateGym({ workspaceId, gymId: gym.id, ...payload })
                else await createGym({ workspaceId, ...payload })
                onOpenChange(false)
                await onSaved()
              } catch (err) {
                setError(errorMessage(err, gym ? "Не удалось сохранить зал" : "Не удалось добавить зал"))
              } finally {
                setSubmitting(false)
              }
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
