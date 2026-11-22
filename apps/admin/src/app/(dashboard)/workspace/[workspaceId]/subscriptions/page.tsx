"use client"

import { MoreHorizontal } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@clubspace/ui-kit/ui"
import { cn } from "@clubspace/ui-kit/util"
import { agree } from "@clubspace/ui-kit/brand"

import {
  deletePlan,
  getPlan,
  listPlans,
  updatePlan,
  type Plan,
} from "../../../../../shared/api/subscriptions"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { pluralRu } from "../../../../../shared/lib/plural-ru"
import { useVocabulary } from "../../../../../shared/lib/vocabulary"
import { confirmDialog } from "../../../../../shared/ui/confirm-dialog"
import { formatAmount } from "../../../../../features/subscriptions/subscription-display"
import { PlanFormSheet } from "../../../../../features/subscriptions/PlanFormSheet"
import {
  ALL_DIRECTIONS,
  DirectionFilter,
} from "../../../../../features/directions/DirectionFilter"
import { DirectionScopeChips } from "../../../../../features/directions/DirectionScopePicker"
import { matchesScopeFilter } from "../../../../../features/directions/direction-scope"
import { useDirections } from "../../../../../features/directions/use-directions"

export default function WorkspaceSubscriptionsPage() {
  const vocabulary = useVocabulary()
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  // The tariff in the panel; null = a new one. Kept after closing so the
  // panel doesn't change its title while it slides out.
  const [editing, setEditing] = useState<Plan | null>(null)
  const openForm = (plan: Plan | null) => {
    setEditing(plan)
    setFormOpen(true)
  }
  const { directions } = useDirections(workspaceId)
  const [directionFilter, setDirectionFilter] = useState(ALL_DIRECTIONS)
  // Archived tariffs sink below the ones on sale; otherwise the server order.
  const visiblePlans = plans
    .filter((p) =>
      matchesScopeFilter(
        directionFilter,
        p.directions.map((d) => d.id),
      ),
    )
    .sort((a, b) => Number(!a.isActive) - Number(!b.isActive))

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      const plansRes = await listPlans({ workspaceId, includeInactive: true })
      setPlans(plansRes.data)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить тарифы"))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  // Deep links, once the list is in: ?edit=<planId> («Редактировать» on the
  // tariff page) opens that tariff in the panel, ?new=1 (launch checklist) a
  // blank one. Read from window (not useSearchParams) to avoid a Suspense
  // boundary.
  useEffect(() => {
    if (loading) return
    const url = new URL(window.location.href)
    const id = url.searchParams.get("edit")
    const isNew = url.searchParams.has("new")
    if (!id && !isNew) return
    url.searchParams.delete("edit")
    url.searchParams.delete("new")
    window.history.replaceState(window.history.state, "", url)
    const plan = id ? plans.find((p) => p.id === id) : undefined
    if (plan) openForm(plan)
    else if (isNew) openForm(null)
    // openForm only sets state; re-running on its identity would reopen the
    // panel after every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, plans])

  const toggleActive = async (p: Plan) => {
    if (!workspaceId) return
    try {
      await updatePlan({
        workspaceId,
        planId: p.id,
        data: { isActive: !p.isActive },
      })
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось изменить тариф"))
    }
  }

  // A tariff anyone ever held can't be deleted (purchase history); when people
  // hold it now, the dialog says so and offers the archive instead.
  const remove = async (p: Plan) => {
    if (!workspaceId) return
    setError(null)
    try {
      const { holders } = await getPlan({ workspaceId, planId: p.id })
      if (holders.length > 0) {
        const held = `У тарифа ${holders.length} ${pluralRu(holders.length, "действующий абонемент", "действующих абонемента", "действующих абонементов")}`
        if (!p.isActive) {
          setError(`Тариф «${p.name}» удалить нельзя: ${held.toLowerCase()}.`)
          return
        }
        const archive = await confirmDialog({
          title: `Тариф «${p.name}» удалить нельзя`,
          description: `${held}. Отправьте его в архив: абонементы продолжат действовать до своего срока, новые по нему назначить и купить будет нельзя.`,
          confirmLabel: "В архив",
        })
        if (archive) await toggleActive(p)
        return
      }
      const ok = await confirmDialog({
        title: `Удалить тариф «${p.name}»?`,
        description:
          "Тариф удалится насовсем. Если по нему уже продавали абонементы, удалить не получится — тогда отправьте его в архив.",
        destructive: true,
      })
      if (!ok) return
      await deletePlan({ workspaceId, planId: p.id })
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось удалить тариф"))
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        {plans.length > 0 && directions.length > 0 ? (
          <DirectionFilter
            directions={directions}
            value={directionFilter}
            onChange={setDirectionFilter}
          />
        ) : (
          <span />
        )}
        <Button type="button" onClick={() => openForm(null)}>
          Добавить тариф
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : plans.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Тарифов пока нет. Нажмите «Добавить тариф», чтобы задать цену и срок
          абонемента.
        </p>
      ) : visiblePlans.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Нет тарифов в выбранном направлении.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {visiblePlans.map((p) => {
            const details = [
              formatAmount(p.price, p.currency),
              p.classCount != null
                ? `${p.classCount} ${pluralRu(p.classCount, "занятие", "занятия", "занятий")}`
                : "безлимит",
              `${p.durationDays} ${pluralRu(p.durationDays, "день", "дня", "дней")}`,
              p.isFreeTrial && "пробное",
              p.startsOnFirstVisit &&
                `с 1-${agree(vocabulary.session, "й", "го")} ${vocabulary.session.gen}`,
              p.purchasableOnline && "продаётся онлайн",
            ].filter(Boolean)
            return (
              <li key={p.id} className="flex items-center gap-1 pr-2">
                <Link
                  href={`/workspace/${workspaceId}/subscriptions/plans/${p.id}`}
                  className={cn(
                    "min-w-0 flex-1 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
                    !p.isActive && "text-muted-foreground",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <DirectionScopeChips directions={p.directions} />
                    {!p.isActive && (
                      <span className="text-xs text-muted-foreground">
                        в архиве
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {details.join(" · ")}
                  </div>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Действия с тарифом «${p.name}»`}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => openForm(p)}
                    >
                      Изменить
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void toggleActive(p)}>
                      {p.isActive ? "В архив" : "Вернуть из архива"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => void remove(p)}
                    >
                      Удалить
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            )
          })}
        </ul>
      )}

      {plans.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Абонемент назначается в карточке ученика; кому пора продлить — в
          «Удержание → Продлить».
        </p>
      )}

      {workspaceId && (
        <PlanFormSheet
          workspaceId={workspaceId}
          open={formOpen}
          onOpenChange={setFormOpen}
          plan={editing}
          directions={directions}
          onSaved={() => void load()}
        />
      )}
    </div>
  )
}
