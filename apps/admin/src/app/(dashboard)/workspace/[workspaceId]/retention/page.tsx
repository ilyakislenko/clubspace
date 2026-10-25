"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"

import {
  listGroups,
  listGyms,
  type Gym,
  type GroupSummary,
} from "../../../../../shared/api/groups"
import {
  listAtRiskMembers,
  logAtRiskContact,
  type AtRiskList,
  type AtRiskMember,
  type AtRiskReason,
} from "../../../../../shared/api/retention"
import {
  AT_RISK_CHIP,
  AT_RISK_LABEL,
  AT_RISK_REFRESH_MS,
  filterAtRisk,
} from "../../../../../shared/lib/at-risk"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { formatRelativeDays } from "../../../../../shared/lib/member-activity"
import { useThrottledCallback } from "../../../../../shared/lib/throttle"
import { useWorkspaceRealtime } from "../../../../../shared/realtime/useWorkspaceRealtime"

const ALL = "all"

const CHIPS: { key: AtRiskReason | null; label: string }[] = [
  { key: null, label: "Все" },
  { key: "lapsed", label: "Абонемент кончился" },
  { key: "newcomer", label: "Новички" },
  { key: "absent", label: "Давно не были" },
  { key: "declining", label: "Реже, чем раньше" },
]

const memberName = (m: AtRiskMember) =>
  [m.firstname, m.lastname].filter(Boolean).join(" ") || m.email

export default function RetentionPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [list, setList] = useState<AtRiskList | null>(null)
  const [gyms, setGyms] = useState<Gym[]>([])
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [gymId, setGymId] = useState(ALL)
  const [groupId, setGroupId] = useState(ALL)
  const [reason, setReason] = useState<AtRiskReason | null>(null)
  const [showSnoozed, setShowSnoozed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      setList(
        await listAtRiskMembers({
          workspaceId,
          gymId: gymId === ALL ? undefined : gymId,
          groupId: groupId === ALL ? undefined : groupId,
        }),
      )
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить список."))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, gymId, groupId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  // Filters are best-effort: the list works without them.
  useEffect(() => {
    if (!workspaceId) return
    void listGyms({ workspaceId })
      .then((res) => setGyms(res.data))
      .catch(() => setGyms([]))
    void listGroups({ workspaceId })
      .then((res) => setGroups(res.data))
      .catch(() => setGroups([]))
  }, [workspaceId])

  const refresh = useThrottledCallback(() => void load(), AT_RISK_REFRESH_MS)
  useWorkspaceRealtime(
    workspaceId,
    ["members", "attendance", "subscription"],
    refresh,
  )

  const visibleGroups =
    gymId === ALL ? groups : groups.filter((g) => g.gym?.id === gymId)

  const startEditing = (userId: string) => {
    setEditingId(userId)
    setNote("")
    setError(null)
  }

  const save = async (m: AtRiskMember) => {
    if (!workspaceId || saving) return
    setSaving(true)
    setError(null)
    try {
      await logAtRiskContact({
        workspaceId,
        userId: m.userId,
        note: note.trim() || null,
      })
      setEditingId(null)
      await load()
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить отметку."))
    } finally {
      setSaving(false)
    }
  }

  const summary = list?.summary
  const count = (key: AtRiskReason | null) =>
    summary ? (key === null ? summary.total : summary[key]) : 0
  const rows = filterAtRisk(list?.data ?? [], reason, showSnoozed)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Кто пропадает</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ученики, которые могут уйти. Один звонок тренера заметно продлевает
          членство.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="w-56">
          <Select
            value={gymId}
            onValueChange={(v) => {
              setGymId(v)
              setGroupId(ALL)
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Зал" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все залы</SelectItem>
              {gyms.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-56">
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger>
              <SelectValue placeholder="Группа" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все группы</SelectItem>
              {visibleGroups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => setReason(c.key)}
            className={`rounded-full px-3 py-1 text-sm ${
              reason === c.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground hover:bg-muted/70"
            }`}
          >
            {c.label} · {count(c.key)}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showSnoozed}
            onChange={(e) => setShowSnoozed(e.target.checked)}
          />
          Показать отработанных ({summary?.snoozed ?? 0})
        </label>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg border border-border bg-muted"
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Сейчас никто не под риском.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-3">Участник</th>
                <th className="p-3">Причина</th>
                <th className="p-3">Что видно</th>
                <th className="p-3">Группы</th>
                <th className="p-3">Телефон</th>
                <th className="p-3">Последний контакт</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((m) => (
                <tr key={m.userId} className="align-top">
                  <td className="p-3">
                    <Link
                      href={`/workspace/${workspaceId}/users/${m.userId}`}
                      className="font-medium hover:underline"
                    >
                      {memberName(m)}
                    </Link>
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${AT_RISK_CHIP[m.reason]}`}
                    >
                      {AT_RISK_LABEL[m.reason]}
                    </span>
                  </td>
                  <td className="p-3">{m.factsText}</td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {m.groups
                      .map((g) =>
                        g.gymName ? `${g.name} · ${g.gymName}` : g.name,
                      )
                      .join(", ")}
                  </td>
                  <td className="whitespace-nowrap p-3">
                    {m.phone ? (
                      <a
                        href={`tel:${m.phone}`}
                        className="text-primary hover:underline"
                      >
                        {m.phone}
                      </a>
                    ) : (
                      <span className="italic text-muted-foreground">
                        не указан
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {m.lastContact
                      ? `${formatRelativeDays(m.lastContact.at)} — ${m.lastContact.byName}${
                          m.lastContact.note ? ` «${m.lastContact.note}»` : ""
                        }`
                      : "—"}
                  </td>
                  <td className="p-3">
                    {editingId === m.userId ? (
                      <div className="flex min-w-72 items-center gap-2">
                        <Input
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Заметка (необязательно)"
                          maxLength={500}
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void save(m)}
                          disabled={saving}
                        >
                          {saving ? "Сохраняю…" : "Сохранить"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditingId(null)}
                          disabled={saving}
                        >
                          Отмена
                        </Button>
                      </div>
                    ) : m.canContact ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => startEditing(m.userId)}
                      >
                        Связались
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
