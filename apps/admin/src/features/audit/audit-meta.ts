import {
  FileVideo,
  ListVideo,
  LucideIcon,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UserPlus,
  UserMinus,
  Activity,
  Pencil,
  Calendar,
  CalendarOff,
  CalendarPlus,
  Megaphone,
  MapPin,
  Snowflake,
  Wallet,
  RefreshCw,
} from "lucide-react"

export type ActionMeta = {
  label: string
  icon: LucideIcon
  tone: "blue" | "green" | "red" | "amber" | "zinc" | "indigo"
}

export const ACTION_META: Record<string, ActionMeta> = {
  "video.startUpload": {
    label: "Загрузка видео начата",
    icon: UploadCloud,
    tone: "blue",
  },
  "video.completeUpload": {
    label: "Видео загружено",
    icon: FileVideo,
    tone: "green",
  },
  "video.update": {
    label: "Видео отредактировано",
    icon: Pencil,
    tone: "indigo",
  },
  "video.delete": { label: "Видео удалено", icon: Trash2, tone: "red" },
  "video.bulkUpdate": {
    label: "Массовое изменение видео",
    icon: ListVideo,
    tone: "indigo",
  },
  "playlist.create": {
    label: "Курс создан",
    icon: ListVideo,
    tone: "green",
  },
  "playlist.update": {
    label: "Курс обновлён",
    icon: Pencil,
    tone: "indigo",
  },
  "playlist.delete": {
    label: "Курс удалён",
    icon: Trash2,
    tone: "red",
  },
  "member.add": {
    label: "Участник принят",
    icon: UserPlus,
    tone: "green",
  },
  "member.rejectPending": {
    label: "Заявка отклонена",
    icon: UserMinus,
    tone: "red",
  },
  "member.remove": {
    label: "Участник удалён",
    icon: UserMinus,
    tone: "red",
  },
  "member.updateAccess": {
    label: "Доступ участника изменён",
    icon: ShieldCheck,
    tone: "amber",
  },
  "member.updateRole": {
    label: "Роль участника изменена",
    icon: ShieldCheck,
    tone: "indigo",
  },
  "member.updateProfile": {
    label: "Профиль участника обновлён",
    icon: Pencil,
    tone: "indigo",
  },
  "member.updateOwnProfile": {
    label: "Участник изменил своё имя",
    icon: Pencil,
    tone: "indigo",
  },
  "member.updateNotes": {
    label: "Заметки об участнике изменены",
    icon: Pencil,
    tone: "indigo",
  },
  "member.import": {
    label: "Импорт участников",
    icon: UserPlus,
    tone: "green",
  },
  "member.markSubscriptionPaid": {
    label: "Оплата отмечена",
    icon: Wallet,
    tone: "green",
  },
  "member.unmarkSubscriptionPaid": {
    label: "Отметка оплаты отменена",
    icon: Wallet,
    tone: "amber",
  },
  "member.joinByCode": {
    label: "Вступил по коду клуба",
    icon: UserPlus,
    tone: "green",
  },
  "member.freezeSubscription": {
    label: "Абонемент заморожен",
    icon: Snowflake,
    tone: "blue",
  },
  "member.endFreeze": {
    label: "Заморозка завершена досрочно",
    icon: Snowflake,
    tone: "amber",
  },
  "member.cancelFreeze": {
    label: "Заморозка отменена",
    icon: Snowflake,
    tone: "zinc",
  },
  "gym.create": { label: "Зал создан", icon: MapPin, tone: "green" },
  "gym.update": { label: "Зал обновлён", icon: Pencil, tone: "indigo" },
  "gym.delete": { label: "Зал удалён", icon: Trash2, tone: "red" },
  "group.create": { label: "Группа создана", icon: UserPlus, tone: "green" },
  "group.update": {
    label: "Группа отредактирована",
    icon: Pencil,
    tone: "indigo",
  },
  "group.delete": { label: "Группа удалена", icon: Trash2, tone: "red" },
  "group.addMember": {
    label: "Добавлен в группу",
    icon: UserPlus,
    tone: "green",
  },
  "group.removeMember": {
    label: "Удалён из группы",
    icon: UserMinus,
    tone: "amber",
  },
  "group.slotCreate": {
    label: "Слот расписания добавлен",
    icon: CalendarPlus,
    tone: "green",
  },
  "group.slotUpdate": {
    label: "Слот расписания изменён",
    icon: Calendar,
    tone: "indigo",
  },
  "group.slotDelete": {
    label: "Слот расписания удалён",
    icon: Trash2,
    tone: "red",
  },
  "group.exceptionCreate": {
    label: "Отмена тренировки добавлена",
    icon: CalendarOff,
    tone: "amber",
  },
  "group.exceptionUpdate": {
    label: "Отмена тренировки изменена",
    icon: CalendarOff,
    tone: "indigo",
  },
  "group.exceptionDelete": {
    label: "Отмена тренировки снята",
    icon: Calendar,
    tone: "green",
  },
  "event.create": {
    label: "Мероприятие создано",
    icon: Megaphone,
    tone: "green",
  },
  "event.update": {
    label: "Мероприятие обновлено",
    icon: Pencil,
    tone: "indigo",
  },
  "event.delete": {
    label: "Мероприятие удалено",
    icon: Trash2,
    tone: "red",
  },
  "workspace.updateSettings": {
    label: "Настройки клуба",
    icon: ShieldCheck,
    tone: "indigo",
  },
  "workspace.rotateJoinCode": {
    label: "Код клуба сменён",
    icon: RefreshCw,
    tone: "indigo",
  },
  "auth.storeReviewSignIn": {
    label: "Вход аккаунта для проверки магазина приложений",
    icon: ShieldCheck,
    tone: "amber",
  },
  "content.report": {
    label: "Жалоба на контент",
    icon: Activity,
    tone: "amber",
  },
}

export const TONE_CLASS: Record<ActionMeta["tone"], string> = {
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  amber: "bg-amber-50 text-amber-700 ring-amber-600/20",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  zinc: "bg-zinc-100 text-zinc-700 ring-zinc-600/20",
}

export const TARGET_LABEL: Record<string, string> = {
  video: "Видео",
  playlist: "Курс",
  member: "Участник",
  workspace: "Клуб",
  gym: "Зал",
  group: "Группа",
  event: "Мероприятие",
}

export const targetTypeLabel = (targetType: string): string =>
  TARGET_LABEL[targetType] ?? targetType

// Who performed an action: display name, else email, else a human placeholder
// (never a raw id).
export const formatActor = (event: {
  actorLabel?: string | null
  actorEmail?: string | null
  actorId?: string | null
}): string =>
  event.actorLabel ??
  event.actorEmail ??
  (event.actorId ? "Неизвестный пользователь" : "Система")

export const formatDate = (iso: string) => {
  const date = new Date(iso)
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export const formatRelative = (iso: string): string | null => {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return "только что"
  if (min < 60) return `${min} мин назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч назад`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} дн назад`
  return null
}

export const META_KEY_LABEL: Record<string, string> = {
  email: "Email",
  isNew: "Новый юзер",
  addedVideos: "Добавлено видео",
  movedVideo: "Перемещён",
  afterId: "После",
  beforeId: "До",
  accessUntil: "Доступ до",
  title: "Название",
  reason: "Причина",
  slotId: "Слот",
  dayOfWeek: "День недели",
  startTime: "Начало",
  durationMin: "Длительность, мин",
  fromDate: "С",
  untilDate: "По",
  days: "Дней",
  returnedDays: "Возвращено дней",
  planName: "Тариф",
  exceptionId: "Отмена",
  gymId: "Зал",
  coachId: "Тренер",
  groupId: "Группа",
  startAt: "Начало",
  endAt: "Окончание",
  publishedAt: "Публикация",
  timezone: "Часовой пояс",
  changes: "Изменения",
  fields: "Поля",
  name: "Название",
  memberCount: "Участников",
  scheduleText: "Расписание",
  fromRoleId: "Роль до",
  toRoleId: "Роль после",
  fromRoleName: "Роль до",
  toRoleName: "Роль после",
  chapterId: "Глава",
  beforeChapterId: "Глава до",
  afterChapterId: "Глава после",
  movedChapter: "Перемещена глава",
  addedChapter: "Добавлена глава",
  removedChapter: "Удалена глава",
  updatedVideo: "Обновлено видео",
}

export const DAY_OF_WEEK_LABEL: Record<string, string> = {
  "1": "Пн",
  "2": "Вт",
  "3": "Ср",
  "4": "Чт",
  "5": "Пт",
  "6": "Сб",
  "7": "Вс",
}

export const formatMetaValue = (value: unknown): string => {
  if (value === null || value === undefined) return "—"
  if (typeof value === "boolean") return value ? "да" : "нет"
  if (Array.isArray(value)) {
    if (value.length === 0) return "—"
    return value.map((v) => formatMetaValue(v)).join(", ")
  }
  if (typeof value === "string") {
    if (/^[0-9a-f]{8}-/.test(value)) return value.slice(0, 8) + "…"
    return value
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== null && v !== undefined && v !== "",
    )
    if (entries.length === 0) return "—"
    return entries
      .map(
        ([k, v]) => `${META_KEY_LABEL[k] ?? k}: ${formatMetaValue(v)}`,
      )
      .join("; ")
  }
  return JSON.stringify(value)
}

export const parseMetadata = (
  metadata: unknown,
): Array<{ key: string; label: string; value: string }> => {
  if (!metadata || typeof metadata !== "object") return []
  return Object.entries(metadata as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => ({
      key: k,
      label: META_KEY_LABEL[k] ?? k,
      value:
        k === "dayOfWeek"
          ? (DAY_OF_WEEK_LABEL[String(v)] ?? formatMetaValue(v))
          : formatMetaValue(v),
    }))
}

// Human labels for the action-family filter. Actions are "<entity>.<verb>",
// so filtering by the entity prefix scopes the journal to one area.
export const ACTION_CATEGORY_LABELS: Record<string, string> = {
  video: "Видео",
  playlist: "Курсы",
  member: "Участники",
  group: "Группы",
  gym: "Залы",
  event: "События",
  workspace: "Настройки",
  content: "Контент",
}

export const ACTION_CATEGORIES = Array.from(
  new Set(Object.keys(ACTION_META).map((action) => action.split(".")[0])),
).sort((a, b) =>
  (ACTION_CATEGORY_LABELS[a] ?? a).localeCompare(
    ACTION_CATEGORY_LABELS[b] ?? b,
    "ru",
  ),
)
