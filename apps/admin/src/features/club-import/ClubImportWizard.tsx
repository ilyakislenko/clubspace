"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { fromFirstSession } from "@clubspace/ui-kit/brand"
import { Button } from "@clubspace/ui-kit/ui"

import {
  applyClubImport,
  downloadClubImportTemplate,
  getClubImport,
  listClubImportRows,
  previewClubImport,
  uploadClubImport,
  type ClubImport,
  type ClubImportMapping,
  type ClubImportRow,
  type ClubImportRowAction,
} from "../../shared/api/club-import"
import { errorMessage } from "../../shared/lib/error-message"
import { useVocabulary } from "../../shared/lib/vocabulary"

// The server refuses bigger files too; checking here saves the upload.
const MAX_BYTES = 2 * 1024 * 1024
const PAGE = 100
const POLL_MS = 1000

const ACTION_LABEL: Record<ClubImportRowAction, string> = {
  create: "Новый",
  update: "Обновить",
  invite: "Приглашение",
  skip: "Пропуск",
  error: "Ошибка",
}

const ACTION_TONE: Record<ClubImportRowAction, string> = {
  create: "text-green-700 dark:text-green-400",
  update: "text-blue-700 dark:text-blue-400",
  invite: "text-indigo-700 dark:text-indigo-400",
  skip: "text-muted-foreground",
  error: "text-destructive",
}

const MISSING_LABEL: Record<keyof NonNullable<ClubImport["missing"]>, string> = {
  gyms: "Залы",
  directions: "Направления",
  groups: "Группы",
  plans: "Абонементы",
  ranks: "Пояса / уровни",
}

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"

const setUrlImportId = (id: string | null) => {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set("id", id)
  else url.searchParams.delete("id")
  window.history.replaceState(null, "", url.toString())
}

export function ClubImportWizard({ workspaceId }: { workspaceId: string }) {
  const [imp, setImp] = useState<ClubImport | null>(null)
  const [mapping, setMapping] = useState<ClubImportMapping>({})
  const [createMissing, setCreateMissing] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const [editingMapping, setEditingMapping] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pasted, setPasted] = useState("")

  const adopt = useCallback((next: ClubImport) => {
    setImp(next)
    setMapping(next.mapping)
    setCreateMissing(next.createMissing)
    setOverwrite(next.overwrite)
    setEditingMapping(next.status === "uploaded")
  }, [])

  // Resume an import after a reload (?id=…). Read from window, not
  // useSearchParams, to avoid a Suspense boundary.
  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get("id")
    if (!id) return
    getClubImport({ workspaceId, importId: id })
      .then(adopt)
      .catch(() => setUrlImportId(null))
  }, [workspaceId, adopt])

  const running = imp?.status === "previewing" || imp?.status === "applying"
  useEffect(() => {
    if (!imp || !running) return
    const t = setTimeout(() => {
      getClubImport({ workspaceId, importId: imp.id })
        .then((next) => {
          setImp(next)
          if (next.status === "previewed" || next.status === "applied") {
            setEditingMapping(false)
          }
        })
        .catch((e) => setError(errorMessage(e, "Не удалось узнать состояние импорта")))
    }, POLL_MS)
    return () => clearTimeout(t)
  }, [imp, running, workspaceId])

  const upload = async (file: Blob, fileName: string) => {
    setError(null)
    if (file.size > MAX_BYTES) {
      setError("Файл больше 2 МБ — разделите его на несколько частей")
      return
    }
    setBusy(true)
    try {
      const res = await uploadClubImport({ workspaceId, file, fileName })
      adopt(res)
      setUrlImportId(res.id)
    } catch (e) {
      setError(errorMessage(e, "Не удалось прочитать файл"))
    } finally {
      setBusy(false)
    }
  }

  const runPreview = async () => {
    if (!imp) return
    setError(null)
    setBusy(true)
    try {
      setImp(
        await previewClubImport({
          workspaceId,
          importId: imp.id,
          mapping,
          createMissing,
          overwrite,
        }),
      )
      setEditingMapping(false)
    } catch (e) {
      setError(errorMessage(e, "Не удалось запустить проверку"))
    } finally {
      setBusy(false)
    }
  }

  const runApply = async () => {
    if (!imp) return
    setError(null)
    setBusy(true)
    try {
      setImp(await applyClubImport({ workspaceId, importId: imp.id }))
    } catch (e) {
      setError(errorMessage(e, "Не удалось запустить импорт"))
    } finally {
      setBusy(false)
    }
  }

  const restart = () => {
    setImp(null)
    setPasted("")
    setError(null)
    setUrlImportId(null)
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {!imp && (
        <UploadStep
          busy={busy}
          pasted={pasted}
          onPasted={setPasted}
          onFile={(f) => void upload(f, f.name)}
          onPaste={() =>
            void upload(new Blob([pasted], { type: "text/csv" }), "вставка-из-таблицы.csv")
          }
          onTemplate={() =>
            void downloadClubImportTemplate({ workspaceId }).catch((e) =>
              setError(errorMessage(e, "Не удалось скачать шаблон")),
            )
          }
        />
      )}

      {imp && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-4 text-sm">
          <span>
            Файл <b>{imp.fileName}</b> · строк: {imp.rowCount} · кодировка{" "}
            {imp.encoding === "windows-1251" ? "Windows-1251" : imp.encoding.toUpperCase()} ·
            разделитель «{imp.delimiter === "\t" ? "табуляция" : imp.delimiter}»
          </span>
          {imp.status !== "applying" && (
            <Button type="button" size="sm" variant="ghost" onClick={restart}>
              Загрузить другой файл
            </Button>
          )}
        </div>
      )}

      {imp && editingMapping && !running && imp.status !== "applied" && (
        <MappingStep
          imp={imp}
          mapping={mapping}
          onMapping={setMapping}
          createMissing={createMissing}
          onCreateMissing={setCreateMissing}
          overwrite={overwrite}
          onOverwrite={setOverwrite}
          busy={busy}
          onPreview={() => void runPreview()}
        />
      )}

      {imp && running && (
        <Progress
          label={imp.status === "applying" ? "Импортируем…" : "Проверяем файл…"}
          processed={imp.processed}
          total={imp.total}
        />
      )}

      {imp?.status === "failed" && (
        <div className="space-y-3 rounded-xl border border-destructive/40 p-4 text-sm">
          <p className="text-destructive">{imp.error ?? "Импорт прервался"}</p>
          <Button type="button" size="sm" onClick={() => setEditingMapping(true)}>
            Проверить ещё раз
          </Button>
        </div>
      )}

      {imp && !editingMapping && (imp.status === "previewed" || imp.status === "applied") && (
        <ResultStep
          workspaceId={workspaceId}
          imp={imp}
          busy={busy}
          onEdit={() => setEditingMapping(true)}
          onApply={() => void runApply()}
        />
      )}
    </div>
  )
}

function UploadStep(props: {
  busy: boolean
  pasted: string
  onPasted: (v: string) => void
  onFile: (f: File) => void
  onPaste: () => void
  onTemplate: () => void
}) {
  const vocabulary = useVocabulary()
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
        <p className="font-medium">Как подготовить файл</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            Одна строка — один ученик (или одно направление ученика: строки с тем же e-mail
            объединяются). Первая строка — названия колонок.
          </li>
          <li>
            В Excel: «Файл → Сохранить как → CSV (разделители — запятые)» или «CSV UTF-8».
            Подходят разделители «,», «;» и табуляция, кодировки UTF-8 и Windows-1251.
          </li>
          <li>
            Колонки: ФИО (фамилия, имя; отчество не сохраняется) или имя и фамилия отдельно,
            e-mail, телефон, дата рождения, e-mail, ФИО и телефон родителя, зал, направление,
            группа, пояс / уровень и полоски, абонемент, дата начала и окончания, осталось
            занятий, оплачено (да/нет), заметки. Даты — 31.12.2025. Колонку уровня можно
            назвать «Пояс», «Уровень», «Ранг» или «Грейд». Если ранги в клубе выключены, она
            не переносится.
          </li>
          <li>
            Абонемент без дат у тарифа «{fromFirstSession(vocabulary)}» начнётся с первой отметки, у
            остальных — с сегодняшнего дня.
          </li>
          <li>
            Ученик без e-mail импортируется только как ребёнок с e-mail родителя: родитель
            подтвердит профиль в приложении. ФИО и телефон родителя заполняют только пустые поля
            его профиля. У кого уже есть аккаунт — получит приглашение в клуб и вступит, когда
            примет его.
          </li>
          <li>
            Перед импортом будет проверка: ничего не сохранится, пока вы не нажмёте
            «Импортировать». Повторный импорт того же файла не создаёт дублей. Писем импорт
            не рассылает. До 5000 строк и 2 МБ за раз.
          </li>
        </ul>
        <Button type="button" size="sm" variant="secondary" onClick={props.onTemplate}>
          Скачать шаблон CSV
        </Button>
      </div>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card p-8 text-sm text-muted-foreground hover:border-primary">
        <span className="font-medium text-foreground">
          {props.busy ? "Загружаем…" : "Выберите CSV-файл"}
        </span>
        <span>.csv или .txt, до 2 МБ</span>
        <input
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          disabled={props.busy}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) props.onFile(f)
            e.target.value = ""
          }}
        />
      </label>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          …или скопируйте ячейки из таблицы вместе с заголовками и вставьте сюда:
        </p>
        <textarea
          value={props.pasted}
          onChange={(e) => props.onPasted(e.target.value)}
          rows={5}
          placeholder={"ФИО\tE-mail\tГруппа\nИванов Иван\tivan@mail.ru\tВзрослые"}
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
        />
        <Button
          type="button"
          size="sm"
          disabled={props.busy || props.pasted.trim() === ""}
          onClick={props.onPaste}
        >
          Продолжить
        </Button>
      </div>
    </div>
  )
}

function MappingStep(props: {
  imp: ClubImport
  mapping: ClubImportMapping
  onMapping: (m: ClubImportMapping) => void
  createMissing: boolean
  onCreateMissing: (v: boolean) => void
  overwrite: boolean
  onOverwrite: (v: boolean) => void
  busy: boolean
  onPreview: () => void
}) {
  const vocabulary = useVocabulary()
  const { imp, mapping } = props
  const sample = (col: number) =>
    imp.sampleRows.map((r) => r[col]).find((v) => v && v.trim() !== "") ?? ""
  const setField = (key: keyof ClubImportMapping, value: string) => {
    const next = { ...mapping }
    if (value === "") delete next[key]
    else next[key] = Number(value)
    props.onMapping(next)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4">
        <p className="mb-1 text-sm font-medium">Сопоставьте колонки</p>
        <p className="mb-3 text-xs text-muted-foreground">
          Мы угадали колонки по заголовкам — проверьте и поправьте. Поля без колонки не
          импортируются.
        </p>
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {imp.fields.map((f) => (
            <label key={f.key} className="grid grid-cols-[9rem_1fr] items-center gap-2 text-sm">
              <span>{f.label}</span>
              <select
                className={selectClass}
                value={mapping[f.key] ?? ""}
                onChange={(e) => setField(f.key, e.target.value)}
              >
                <option value="">— не импортировать —</option>
                {imp.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h}
                    {sample(i) ? ` (${sample(i).slice(0, 24)})` : ""}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              {imp.headers.map((h, i) => (
                <th key={i} className="whitespace-nowrap px-2 py-1 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {imp.sampleRows.map((r, i) => (
              <tr key={i} className="border-t">
                {r.map((c, j) => (
                  <td key={j} className="whitespace-nowrap px-2 py-1">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={props.createMissing}
            onChange={(e) => props.onCreateMissing(e.target.checked)}
          />
          <span>
            <b>Создать недостающие</b> — залы, направления, группы, абонементы и пояса / уровни из
            файла, которых нет в клубе. Иначе такие строки пропускаются. Новые группы
            ведёте вы ({vocabulary.coach.acc} можно сменить в группе), новые абонементы — с ценой 0 ₽ и
            сроком 30 дней: поправьте их в «Тарифах».
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={props.overwrite}
            onChange={(e) => props.onOverwrite(e.target.checked)}
          />
          <span>
            <b>Перезаписать</b> — имя, фамилию, дату рождения, пояс / уровень и заметки у уже
            существующих участников. Иначе заполняются только пустые поля.
          </span>
        </label>
      </div>

      <Button type="button" disabled={props.busy} onClick={props.onPreview}>
        {props.busy ? "Запускаем…" : "Проверить"}
      </Button>
    </div>
  )
}

function Progress({ label, processed, total }: { label: string; processed: number; total: number }) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0
  return (
    <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
      <p>
        {label} {processed} из {total}
      </p>
      <div className="h-2 overflow-hidden rounded bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        Можно уйти со страницы — импорт продолжится, а результат будет здесь.
      </p>
    </div>
  )
}

function ResultStep(props: {
  workspaceId: string
  imp: ClubImport
  busy: boolean
  onEdit: () => void
  onApply: () => void
}) {
  const { imp } = props
  const applied = imp.status === "applied"
  const s = imp.summary
  const [filter, setFilter] = useState<ClubImportRowAction | "all">("all")
  const [rows, setRows] = useState<ClubImportRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listClubImportRows({
      workspaceId: props.workspaceId,
      importId: imp.id,
      action: filter === "all" ? undefined : filter,
      offset,
      limit: PAGE,
    })
      .then((res) => {
        setRows(res.data)
        setTotal(res.total)
      })
      .catch((e) => setError(errorMessage(e, "Не удалось загрузить строки")))
  }, [props.workspaceId, imp.id, imp.status, filter, offset])

  const missing = imp.missing
  const missingKinds = missing
    ? (Object.keys(MISSING_LABEL) as Array<keyof typeof MISSING_LABEL>).filter(
        (k) => missing[k].length > 0,
      )
    : []
  const changes = s ? s.create + s.update + s.invite : 0
  const created = s
    ? [
        [s.createdGyms, "залов"],
        [s.createdDirections, "направлений"],
        [s.createdGroups, "групп"],
        [s.createdPlans, "абонементов"],
        [s.createdRanks, "поясов / уровней"],
      ].filter(([n]) => (n as number) > 0)
    : []

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4">
        <p className="mb-3 text-sm font-medium">
          {applied ? "Импорт завершён" : "Проверка: так будет после импорта"}
        </p>
        {s && (
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <Stat label={applied ? "Новых" : "Будет создано"} value={s.create} />
            <Stat label={applied ? "Обновлено" : "Будет обновлено"} value={s.update} />
            <Stat label="Приглашений" value={s.invite} />
            <Stat label="Пропущено" value={s.skip} />
            <Stat label="Ошибок" value={s.error} tone={s.error > 0 ? "text-destructive" : undefined} />
          </div>
        )}
        {s && (
          <p className="mt-3 text-xs text-muted-foreground">
            Детей: {s.children} · мест в группах: {s.groupMemberships} · абонементов:{" "}
            {s.subscriptions} · поясов / уровней: {s.ranks}
            {created.length > 0 &&
              ` · ${applied ? "создано" : "будет создано"}: ${created
                .map(([n, label]) => `${n} ${label}`)
                .join(", ")}`}
          </p>
        )}
      </div>

      {missingKinds.length > 0 && missing && (
        <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Нет в клубе</p>
          {missingKinds.map((k) => (
            <p key={k}>
              <span className="text-muted-foreground">{MISSING_LABEL[k]}:</span>{" "}
              {missing[k].join("; ")}
            </p>
          ))}
          {!imp.createMissing && !applied && (
            <p className="text-xs text-muted-foreground">
              Строки с ними будут пропущены. Отметьте «Создать недостающие» или поправьте
              названия в файле.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(["all", "create", "update", "invite", "skip", "error"] as const).map((f) => (
          <Button
            key={f}
            type="button"
            size="sm"
            variant={filter === f ? "default" : "secondary"}
            onClick={() => {
              setFilter(f)
              setOffset(0)
            }}
          >
            {f === "all" ? "Все" : ACTION_LABEL[f]}
          </Button>
        ))}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Строка</th>
              <th className="px-3 py-2 text-left font-medium">Кто</th>
              <th className="px-3 py-2 text-left font-medium">Действие</th>
              <th className="px-3 py-2 text-left font-medium">Что меняется / почему</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.line} className="border-t align-top">
                <td className="px-3 py-2 text-muted-foreground">{r.line}</td>
                <td className="px-3 py-2">
                  {r.name}
                  {r.email && <div className="text-xs text-muted-foreground">{r.email}</div>}
                </td>
                <td className={`px-3 py-2 ${ACTION_TONE[r.action]}`}>{ACTION_LABEL[r.action]}</td>
                <td className="px-3 py-2">
                  {r.changes.length > 0 && <div>{r.changes.join("; ")}</div>}
                  {r.messages.map((m, i) => (
                    <div key={i} className="text-xs text-muted-foreground">
                      {m}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  Нет строк
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {total > PAGE && (
        <div className="flex items-center gap-2 text-sm">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE))}
          >
            Назад
          </Button>
          <span className="text-muted-foreground">
            {offset + 1}–{Math.min(offset + PAGE, total)} из {total}
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={offset + PAGE >= total}
            onClick={() => setOffset(offset + PAGE)}
          >
            Дальше
          </Button>
        </div>
      )}

      {applied ? (
        <Link
          href={`/workspace/${props.workspaceId}/users`}
          className="inline-block text-sm text-primary underline"
        >
          Перейти к участникам
        </Link>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={props.onEdit}>
            Изменить сопоставление
          </Button>
          <Button type="button" disabled={props.busy || changes === 0} onClick={props.onApply}>
            {changes === 0 ? "Нечего импортировать" : `Импортировать (${changes})`}
          </Button>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className={`text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
