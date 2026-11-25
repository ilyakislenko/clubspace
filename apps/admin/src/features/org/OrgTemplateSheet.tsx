"use client"

import { useEffect, useState } from "react"

import {
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import {
  createOrgLadderTemplate,
  deleteOrgLadderTemplate,
  updateOrgLadderTemplate,
  type OrgLadderTemplate,
} from "../../shared/api/organizations"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { confirmLeave, sameData, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { confirmDialog } from "../../shared/ui/confirm-dialog"

const L = FORM_LIMITS.orgTemplate

// A federation standard ladder: its name, who it is for, and whether clubs
// are offered it (a hidden one keeps the clubs' copies).
export function OrgTemplateSheet({
  organizationId,
  open,
  onOpenChange,
  template,
  onSaved,
}: {
  organizationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // null = a new standard.
  template: OrgLadderTemplate | null
  onSaved: () => void
}) {
  const [name, setName] = useState("")
  const [audience, setAudience] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(template?.name ?? "")
    setAudience(template?.audience ?? "")
    setIsActive(template?.isActive ?? true)
    setError("")
  }, [open, template])

  const saved = { name: template?.name ?? "", audience: template?.audience ?? "", isActive: template?.isActive ?? true }
  const dirty = open && !sameData({ name, audience, isActive }, saved)
  useDirtyGuard(dirty)
  const requestClose = async () => {
    if (await confirmLeave()) onOpenChange(false)
  }

  const run = async (action: () => Promise<unknown>, failText: string) => {
    setSaving(true)
    setError("")
    try {
      await action()
      onSaved()
      onOpenChange(false)
    } catch (e) {
      setError(errorMessage(e, failText))
    } finally {
      setSaving(false)
    }
  }

  const submit = () =>
    run(
      () =>
        template
          ? updateOrgLadderTemplate({
              organizationId,
              templateId: template.id,
              data: { name: name.trim(), audience: audience.trim() || null, isActive },
            })
          : createOrgLadderTemplate({ organizationId, data: { name: name.trim(), audience: audience.trim() || null } }),
      "Не удалось сохранить стандарт",
    )

  const remove = async () => {
    if (!template) return
    const ok = await confirmDialog({
      title: `Удалить стандарт «${template.name}»?`,
      description: "Клубы, которые взяли его за основу, сохранят свои лестницы.",
      destructive: true,
    })
    if (ok)
      await run(
        () => deleteOrgLadderTemplate({ organizationId, templateId: template.id }),
        "Не удалось удалить стандарт",
      )
  }

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{template ? "Редактировать стандарт" : "Новый стандарт"}</SheetTitle>
          <SheetDescription>Клубы федерации берут стандарт за основу: копию клуб правит сам.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto">
          <div className="space-y-2">
            <Label htmlFor="org-template-name">Название</Label>
            <Input
              id="org-template-name"
              value={name}
              maxLength={L.name.max}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Пояса (взрослые)"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-template-audience">Для кого (необязательно)</Label>
            <Input
              id="org-template-audience"
              value={audience}
              maxLength={L.audience.max}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="Например: взрослые или дети 5–13 лет"
            />
          </div>
          {template && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Предлагать клубам
            </label>
          )}
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <SheetFooter>
          <div className="flex w-full items-center gap-2">
            {template && (
              <Button type="button" variant="ghost" className="text-destructive" disabled={saving} onClick={() => void remove()}>
                Удалить
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="ghost" disabled={saving} onClick={() => void requestClose()}>
                Отмена
              </Button>
              <Button type="button" disabled={saving || !name.trim()} onClick={() => void submit()}>
                {saving ? "Сохраняем…" : template ? "Сохранить" : "Создать стандарт"}
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
