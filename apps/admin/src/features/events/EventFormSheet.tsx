"use client"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import type { WorkspaceEvent } from "../../shared/api/events"
import { confirmLeave } from "../../shared/lib/use-dirty-guard"
import { EventForm, type EventFormProps } from "./EventForm"

type Props = Omit<EventFormProps, "event" | "onCancel" | "onSaved" | "onDeleted"> & {
  open: boolean
  onOpenChange: (open: boolean) => void
  // null = a new event.
  event: WorkspaceEvent | null
  // After a save or a delete.
  onChanged: () => void
}

// The event editor in a side panel. Closing it with unsaved changes asks
// first; the form mounts with the open panel, so each opening starts from the
// edited event (or the new-event defaults).
export function EventFormSheet({
  open,
  onOpenChange,
  event,
  onChanged,
  ...form
}: Props) {
  const requestClose = async () => {
    if (await confirmLeave()) onOpenChange(false)
  }
  const done = () => {
    onChanged()
    onOpenChange(false)
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}
    >
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{event ? "Редактировать событие" : "Новое событие"}</SheetTitle>
          <SheetDescription>
            Событие видят все участники клуба в приложении.
          </SheetDescription>
        </SheetHeader>
        <EventForm
          key={event?.id ?? "new"}
          event={event ?? undefined}
          onCancel={() => void requestClose()}
          onSaved={done}
          onDeleted={done}
          {...form}
        />
      </SheetContent>
    </Sheet>
  )
}
