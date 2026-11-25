"use client"

import { useEffect, useState } from "react"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@clubspace/ui-kit/ui"

import { getOrganizationRegistryPerson, type OrgRegistryPerson } from "../../shared/api/organizations"
import { errorMessage } from "../../shared/lib/error-message"
import { BeltDot } from "./BeltDot"
import { beltText, confirmedByText, formatDate } from "./org-view"

// One person's belts confirmed by the member clubs, newest first.
export function RegistryPersonSheet({
  organizationId,
  personKey,
  personName,
  onClose,
}: {
  organizationId: string
  // null = closed.
  personKey: string | null
  personName: string
  onClose: () => void
}) {
  const [person, setPerson] = useState<OrgRegistryPerson | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!personKey) return
    let cancelled = false
    setPerson(null)
    setError(null)
    getOrganizationRegistryPerson({ organizationId, personKey })
      .then((p) => !cancelled && setPerson(p))
      .catch((e) => !cancelled && setError(errorMessage(e, "Не удалось загрузить историю")))
    return () => {
      cancelled = true
    }
  }, [organizationId, personKey])

  return (
    <Sheet open={personKey !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{person?.personName ?? personName}</SheetTitle>
          <SheetDescription>Пояса, подтверждённые клубами федерации.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">
          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : !person ? (
            <div className="h-24 animate-pulse rounded-lg border border-border bg-muted" />
          ) : (
            <ol className="divide-y divide-border rounded-lg border border-border">
              {person.history.map((row, i) => (
                <li key={`${row.ladderName}-${row.awardedAt}-${i}`} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                  <BeltDot color={row.levelColor} className="mt-1" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{beltText(row)}</div>
                    <div className="text-xs text-muted-foreground">
                      {confirmedByText(row.clubName)} · {row.ladderName}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatDate(row.awardedAt)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
