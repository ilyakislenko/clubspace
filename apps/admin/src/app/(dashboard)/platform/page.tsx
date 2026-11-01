"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@clubspace/ui-kit/ui"

import { fetchMe } from "../../../shared/api/me"
import {
  createPlatformWorkspace,
  fetchPlatformOverview,
  fetchPlatformWorkspaces,
  updatePlatformWorkspace,
  type PlatformOverview,
  type PlatformWorkspace,
  type PlatformWorkspacesQuery,
} from "../../../shared/api/platform"
import { errorMessage } from "../../../shared/lib/error-message"
import { setActiveWorkspaceId } from "../../../shared/workspace/storage"
import { PlatformAuditFeed } from "../../../features/platform/PlatformAuditFeed"
import { PlatformOnboardingRequests } from "../../../features/platform/PlatformOnboardingRequests"
import { PlatformDemoRequests } from "../../../features/platform/PlatformDemoRequests"
import { PlatformWorkspaceBilling } from "../../../features/platform/PlatformWorkspaceBilling"
import { inputClsFull } from "../../../shared/lib/input-class"

// Mirrors the server's WorkspaceType enum. Deliberately not BJJ-only: the
// platform is multi-discipline and a creator picks what their club actually is.
const WORKSPACE_TYPES = [
  { value: "GRAPPLING", label: "Единоборства / грэпплинг" },
  { value: "FITNESS", label: "Фитнес" },
  { value: "YOGA", label: "Йога" },
  { value: "CUSTOM", label: "Другое" },
] as const

const PER_PAGE = 20

type StatusFilter = NonNullable<PlatformWorkspacesQuery["status"]>

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "TRIAL", label: "Пробный период" },
  { value: "ACTIVE", label: "Оплачен" },
  { value: "PAST_DUE", label: "Ожидает оплаты" },
  { value: "SUSPENDED", label: "Приостановлен" },
]

// «поле:направление» — one select for both.
const SORTS = [
  { value: "createdAt:desc", label: "Сначала новые" },
  { value: "createdAt:asc", label: "Сначала старые" },
  { value: "name:asc", label: "По названию" },
  { value: "activeMembers:desc", label: "Больше активных" },
  { value: "activeMembers:asc", label: "Меньше активных" },
  { value: "tier:desc", label: "Тариф: от старшего" },
  { value: "tier:asc", label: "Тариф: от младшего" },
] as const

type SortValue = (typeof SORTS)[number]["value"]
type SortField = NonNullable<PlatformWorkspacesQuery["sort"]>
type SortOrder = NonNullable<PlatformWorkspacesQuery["order"]>

// A null metric (nothing to average yet) reads «—».
const StatCard = ({ label, value }: { label: string; value: number | string | null }) => (
  <div className="rounded-lg border bg-card p-4">
    <div className="text-2xl font-semibold">{value ?? "—"}</div>
    <div className="text-xs text-muted-foreground">{label}</div>
  </div>
)

export default function PlatformConsolePage() {
  const router = useRouter()

  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [overview, setOverview] = useState<PlatformOverview | null>(null)
  const [workspaces, setWorkspaces] = useState<PlatformWorkspace[]>([])
  const [total, setTotal] = useState(0)
  const [curPage, setCurPage] = useState(1)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<StatusFilter | "">("")
  const [tier, setTier] = useState("")
  const [promo, setPromo] = useState<"" | "yes" | "no">("")
  const [sort, setSort] = useState<SortValue>("createdAt:desc")
  const [tiers, setTiers] = useState<Array<{ code: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")
  const [type, setType] = useState<string>("GRAPPLING")
  const [key, setKey] = useState("")
  const [timezone, setTimezone] = useState("")
  // The operator attests the owner already accepted (a signed contract).
  const [ownerAcceptedOffer, setOwnerAcceptedOffer] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Row being edited, with its draft values. One at a time — the console is a
  // low-traffic staff tool and a single open editor keeps the list readable.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editOwner, setEditOwner] = useState("")
  const [editActive, setEditActive] = useState(true)

  const startEdit = (w: PlatformWorkspace) => {
    setEditingId(w.workspaceId)
    setEditName(w.name)
    setEditOwner(w.owner?.email ?? "")
    setEditActive(w.isActive)
    setNotice(null)
    setError(null)
  }

  const handleSaveEdit = async (w: PlatformWorkspace) => {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const result = await updatePlatformWorkspace(w.workspaceId, {
        name: editName.trim(),
        isActive: editActive,
        // Unchanged address is a no-op server-side, so it can always be sent.
        ...(editOwner.trim() ? { ownerEmail: editOwner.trim() } : {}),
      })
      setNotice(
        result.ownerTransferred
          ? `«${result.workspace.name}» передан владельцу ${result.workspace.owner?.email}${
              result.ownerCreated ? " (аккаунт создан)" : ""
            }.`
          : `«${result.workspace.name}» сохранён.`,
      )
      setEditingId(null)
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось сохранить клуб."))
    } finally {
      setSaving(false)
    }
  }

  // The console is gated on the account, not on a membership — a platform
  // admin usually belongs to no workspace at all.
  useEffect(() => {
    let alive = true
    fetchMe()
      .then((me) => alive && setAllowed(me.isSuperAdmin))
      .catch(() => alive && setAllowed(false))
    return () => {
      alive = false
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sortField, sortOrder] = sort.split(":") as [SortField, SortOrder]
      const [page, stats] = await Promise.all([
        fetchPlatformWorkspaces({
          curPage,
          perPage: PER_PAGE,
          search,
          ...(status ? { status } : {}),
          ...(tier ? { tier } : {}),
          ...(promo ? { promo: promo === "yes" } : {}),
          sort: sortField,
          order: sortOrder,
        }),
        fetchPlatformOverview(),
      ])
      setWorkspaces(page.data)
      setTotal(page.meta.total)
      setTiers(page.tiers)
      setOverview(stats)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить список клубов."))
    } finally {
      setLoading(false)
    }
  }, [curPage, search, status, tier, promo, sort])

  useEffect(() => {
    if (allowed) void load()
  }, [allowed, load])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const result = await createPlatformWorkspace({
        name: name.trim(),
        ownerEmail: ownerEmail.trim(),
        type: type as "GRAPPLING",
        ...(key.trim() ? { key: key.trim() } : {}),
        ...(timezone.trim() ? { timezone: timezone.trim() } : {}),
        ...(ownerAcceptedOffer ? { ownerAcceptedOffer: true } : {}),
      })
      const created = result.ownerCreated
        ? `Клуб «${result.workspace.name}» создан (ключ ${result.workspace.key}). Аккаунт ${result.workspace.owner?.email} создан — владелец входит по коду на почту, пароль не нужен.`
        : `Клуб «${result.workspace.name}» создан (ключ ${result.workspace.key}) и передан существующему аккаунту ${result.workspace.owner?.email}.`
      setNotice(
        `${created} ${
          result.ownerNotified
            ? `Письмо со ссылкой для входа отправлено на ${result.workspace.owner?.email}.`
            : `Письмо отправить не удалось — передайте владельцу адрес админки: ${window.location.origin}`
        }`,
      )
      setName("")
      setOwnerEmail("")
      setKey("")
      setTimezone("")
      setOwnerAcceptedOffer(false)
      setShowForm(false)
      setCurPage(1)
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось создать клуб."))
    } finally {
      setSaving(false)
    }
  }

  const openWorkspace = (workspaceId: string) => {
    setActiveWorkspaceId(workspaceId)
    router.push(`/workspace/${workspaceId}`)
  }

  if (allowed === null) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Проверяем доступ…</div>
    )
  }

  if (!allowed) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-medium">Раздел только для администраторов платформы</div>
          <p className="mt-1 text-xs leading-relaxed">
            Это консоль над клубами: создание клубов и передача их владельцам.
            Управление своим клубом — в разделе «Клубы».
          </p>
        </div>
        <Button
          className="mt-4"
          variant="ghost"
          size="sm"
          onClick={() => router.push("/workspaces")}
        >
          К моим клубам
        </Button>
      </div>
    )
  }

  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Платформа</h1>
          <p className="text-sm text-muted-foreground">
            Все клубы платформы. Отсюда создаётся новый клуб и передаётся владельцу.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Отмена" : "Создать клуб"}
        </Button>
      </div>

      {overview && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Клубов" value={overview.workspaceCount} />
          <StatCard label="Активных" value={overview.activeWorkspaceCount} />
          <StatCard label="Пользователей" value={overview.userCount} />
          <StatCard
            label="Активных участий"
            value={overview.activeMembershipCount}
          />
          <StatCard
            label="Админов платформы"
            value={overview.platformAdminCount}
          />
          <StatCard label="На пробном периоде" value={overview.trialWorkspaceCount} />
          <StatCard label="Ожидают оплаты" value={overview.pastDueWorkspaceCount} />
          <StatCard label="Приостановлены" value={overview.suspendedWorkspaceCount} />
        </div>
      )}

      {overview && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Пробные периоды</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Пробных начато" value={overview.trials.started} />
            <StatCard label="Идёт сейчас" value={overview.trials.running} />
            <StatCard label="Оплатили" value={overview.trials.converted} />
            <StatCard
              label="Конверсия"
              value={
                overview.trials.conversionPercent === null
                  ? null
                  : `${overview.trials.conversionPercent}%`
              }
            />
            <StatCard
              label="В среднем дней до оплаты"
              value={overview.trials.averageDaysToConvert}
            />
            <StatCard
              label="Открытых заявок на помощь с подключением"
              value={overview.openOnboardingRequestCount}
            />
          </div>
        </section>
      )}

      {notice && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="space-y-4 rounded-lg border bg-card p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Название клуба</span>
              <input
                className={inputClsFull}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Академия БЖЖ Москва"
                required
                maxLength={255}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">
                Почта владельца
              </span>
              <input
                className={inputClsFull}
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="coach@club.ru"
                required
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Тип клуба</span>
              <select
                className={inputClsFull}
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {WORKSPACE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">
                Часовой пояс (необязательно)
              </span>
              <input
                className={inputClsFull}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="Europe/Moscow"
                maxLength={64}
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-xs text-muted-foreground">
                Ключ (необязательно — иначе построим из названия)
              </span>
              <input
                className={inputClsFull}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="akademiya_bzhzh_moskva"
                maxLength={50}
              />
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0"
              checked={ownerAcceptedOffer}
              onChange={(e) => setOwnerAcceptedOffer(e.target.checked)}
            />
            <span>
              Владелец уже принял оферту и поручение (подписан договор)
              <span className="block text-xs text-muted-foreground">
                Без отметки владелец примет их сам на странице «Тариф».
              </span>
            </span>
          </label>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Если аккаунта с такой почтой ещё нет, он создастся. Пароль не нужен:
            вход в систему — по коду из письма, поэтому владелец сможет зайти сразу.
          </p>
          <Button type="submit" disabled={saving}>
            {saving ? "Создаём…" : "Создать клуб"}
          </Button>
        </form>
      )}

      <PlatformDemoRequests />

      <PlatformOnboardingRequests
        onShowClub={(workspaceName) => {
          setCurPage(1)
          setSearch(workspaceName)
        }}
        onChanged={async (text) => {
          setNotice(text)
          await load()
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputClsFull} max-w-xs`}
          value={search}
          onChange={(e) => {
            setCurPage(1)
            setSearch(e.target.value)
          }}
          placeholder="Поиск по названию, ключу или почте владельца"
        />
        <select
          className={`${inputClsFull} w-44`}
          value={status}
          aria-label="Статус оплаты"
          onChange={(e) => {
            setCurPage(1)
            setStatus(e.target.value as StatusFilter | "")
          }}
        >
          <option value="">Любой статус</option>
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          className={`${inputClsFull} w-36`}
          value={tier}
          aria-label="Тариф"
          onChange={(e) => {
            setCurPage(1)
            setTier(e.target.value)
          }}
        >
          <option value="">Любой тариф</option>
          {tiers.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          className={`${inputClsFull} w-40`}
          value={promo}
          aria-label="Промо"
          onChange={(e) => {
            setCurPage(1)
            setPromo(e.target.value as "" | "yes" | "no")
          }}
        >
          <option value="">Промо: все</option>
          <option value="yes">С промо</option>
          <option value="no">Без промо</option>
        </select>
        <select
          className={`${inputClsFull} w-48`}
          value={sort}
          aria-label="Сортировка"
          onChange={(e) => {
            setCurPage(1)
            setSort(e.target.value as SortValue)
          }}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {loading && (
          <span className="text-xs text-muted-foreground">Загрузка…</span>
        )}
      </div>

      <div className="grid gap-3">
        {!loading && workspaces.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {search || status || tier || promo
              ? "Ничего не нашлось по этому запросу."
              : "Пока ни одного клуба. Нажми «Создать клуб»."}
          </div>
        ) : (
          workspaces.map((w) => (
            <div key={w.workspaceId} className="rounded-md border p-4">
              <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-medium">{w.name}</span>
                    {!w.isActive && (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900">
                        отключён платформой
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {w.key} · {w.type} · {w.memberCount}{" "}
                    {w.memberCount === 1 ? "участник" : "участников"}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    Владелец: {w.owner?.email ?? "— аккаунт удалён —"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      editingId === w.workspaceId
                        ? setEditingId(null)
                        : startEdit(w)
                    }
                  >
                    {editingId === w.workspaceId ? "Отмена" : "Изменить"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => openWorkspace(w.workspaceId)}
                  >
                    Открыть
                  </Button>
                </div>
              </div>

              <PlatformWorkspaceBilling
                workspace={w}
                onChanged={async (text) => {
                  setNotice(text)
                  await load()
                }}
              />

              {editingId === w.workspaceId && (
                <div className="mt-4 space-y-3 border-t pt-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">
                        Название
                      </span>
                      <input
                        className={inputClsFull}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={255}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">
                        Владелец (почта) — сменить = передать клуб
                      </span>
                      <input
                        className={inputClsFull}
                        type="email"
                        value={editOwner}
                        onChange={(e) => setEditOwner(e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editActive}
                      onChange={(e) => setEditActive(e.target.checked)}
                    />
                    <span>Клуб активен</span>
                  </label>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Снятие галочки отключает клуб: участники, тренеры и владелец
                    видят «Клуб отключён», пока галочку не вернут. Передача клуба
                    оставляет прежнему владельцу его участие в клубе, роль ему
                    меняет уже новый владелец.
                  </p>
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={() => handleSaveEdit(w)}
                  >
                    {saving ? "Сохраняем…" : "Сохранить"}
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={curPage <= 1}
            onClick={() => setCurPage((p) => Math.max(1, p - 1))}
          >
            Назад
          </Button>
          <span className="text-xs text-muted-foreground">
            {curPage} / {pageCount}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={curPage >= pageCount}
            onClick={() => setCurPage((p) => Math.min(pageCount, p + 1))}
          >
            Вперёд
          </Button>
        </div>
      )}

      <PlatformAuditFeed />
    </div>
  )
}
