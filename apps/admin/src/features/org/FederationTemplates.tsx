"use client"

import { useState } from "react"

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import type { Direction } from "../../shared/api/directions"
import { createRankLadderFromTemplate, type AdoptableTemplate } from "../../shared/api/organizations"
import type { RankLadder } from "../../shared/api/ranks"
import { errorMessage } from "../../shared/lib/error-message"
import { pluralRu } from "../../shared/lib/plural-ru"
import { DirectionSelect } from "../directions/DirectionSelect"

// «Стандарт федерации обновлён до версии N» under a club ladder copied from
// an older version; null when it is current or not a copy.
export const templateUpdateNote = (
  ladder: { templateId: string | null; templateVersion: number | null },
  templates: readonly { id: string; version: number }[],
): string | null => {
  if (!ladder.templateId || ladder.templateVersion == null) return null
  const template = templates.find((t) => t.id === ladder.templateId)
  return template && template.version > ladder.templateVersion
    ? `Стандарт федерации обновлён до версии ${template.version}`
    : null
}

// «Стандарты федерации» on «Пояса → Лестницы»: standards of the federations
// the club is in. «Взять за основу» makes an editable copy (no live link).
// Rendered only when there is a standard to take.
export function FederationTemplates({
  workspaceId,
  templates,
  directions,
  allowedDirectionIds,
  defaultDirectionId,
  onAdopted,
}: {
  workspaceId: string
  templates: readonly AdoptableTemplate[]
  directions: Direction[]
  allowedDirectionIds: readonly string[] | undefined
  defaultDirectionId: string | null
  onAdopted: (ladder: RankLadder) => void
}) {
  const [adopting, setAdopting] = useState<AdoptableTemplate | null>(null)
  if (templates.length === 0) return null
  const orgNames = [...new Set(templates.map((t) => t.organizationName))]

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">
        {orgNames.length === 1 ? `Стандарты федерации «${orgNames[0]}»` : "Стандарты федераций"}
      </h2>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {templates.map((t) => {
          const taken = t.adoptedLadders.map((a) => `${a.ladderName} (v${a.templateVersion})`).join(", ")
          return (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground">
                  {[
                    orgNames.length > 1 ? t.organizationName : null,
                    `версия ${t.version}`,
                    `${t.levels.length} ${pluralRu(t.levels.length, "уровень", "уровня", "уровней")}`,
                    taken ? `у вас: ${taken}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => setAdopting(t)}>
                Взять за основу
              </Button>
            </li>
          )
        })}
      </ul>
      <AdoptSheet
        workspaceId={workspaceId}
        template={adopting}
        directions={directions}
        allowedDirectionIds={allowedDirectionIds}
        defaultDirectionId={defaultDirectionId}
        onClose={() => setAdopting(null)}
        onAdopted={(ladder) => {
          setAdopting(null)
          onAdopted(ladder)
        }}
      />
    </section>
  )
}

function AdoptSheet({
  workspaceId,
  template,
  directions,
  allowedDirectionIds,
  defaultDirectionId,
  onClose,
  onAdopted,
}: {
  workspaceId: string
  template: AdoptableTemplate | null
  directions: Direction[]
  allowedDirectionIds: readonly string[] | undefined
  defaultDirectionId: string | null
  onClose: () => void
  onAdopted: (ladder: RankLadder) => void
}) {
  const [directionId, setDirectionId] = useState<string | null>(defaultDirectionId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const adopt = async () => {
    if (!template) return
    setBusy(true)
    setError(null)
    try {
      onAdopted(await createRankLadderFromTemplate({ workspaceId, data: { templateId: template.id, directionId } }))
    } catch (e) {
      setError(errorMessage(e, "Не удалось создать лестницу"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={template !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-md">
        {template && (
          <>
            <SheetHeader>
              <SheetTitle>Взять за основу «{template.name}»</SheetTitle>
              <SheetDescription>
                В клубе появится копия лестницы — её можно менять как свою. Изменения федерации в неё сами не
                попадут.
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-4 overflow-y-auto">
              <ol className="space-y-1 text-sm">
                {template.levels.map((lv, i) => (
                  <li key={lv.id} className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block size-3 shrink-0 rounded-full border border-border"
                      style={{ backgroundColor: lv.color ?? "transparent" }}
                    />
                    {i + 1}. {lv.name}
                  </li>
                ))}
              </ol>
              <DirectionSelect
                id="adopt-template-direction"
                directions={directions}
                value={directionId}
                onChange={setDirectionId}
                allowedIds={allowedDirectionIds}
              />
              {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <SheetFooter>
              <div className="flex w-full items-center justify-end gap-2">
                <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                  Отмена
                </Button>
                <Button type="button" disabled={busy} onClick={() => void adopt()}>
                  Создать копию
                </Button>
              </div>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
