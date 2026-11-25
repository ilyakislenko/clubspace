import {
  Baby,
  Bot,
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
  Globe,
  Download,
  LogIn,
  Lock,
  ShieldAlert,
  CreditCard,
  RotateCcw,
  Layers,
  Percent,
  Archive,
  ArchiveRestore,
} from "lucide-react"

import {
  agree,
  type ClubVocabulary,
  cap,
  vocabularyForWorkspaceType,
} from "@clubspace/ui-kit/brand"

import { formatRoleName } from "../../shared/lib/role-labels"
import { pluralRu } from "../../shared/lib/plural-ru"
import { AI_DATA_MODE_LABEL, AI_TOOL_LABEL } from "../ai-assistant/ai-assistant-config"
import { PROVIDER_LABEL } from "../payments/payment-labels"

export type ActionMeta = {
  label: string
  icon: LucideIcon
  tone: "blue" | "green" | "red" | "amber" | "zinc" | "indigo"
}

// Labels name classes and coaches in the club's words.
export const actionMetaFor = (
  v: ClubVocabulary,
): Record<string, ActionMeta> => ({
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
  "video.regenerateText": {
    label: "Субтитры видео пересозданы",
    icon: RefreshCw,
    tone: "indigo",
  },
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
  "member.invite": {
    label: "Участник приглашён",
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
    label: "Участник изменил свой профиль",
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
  "club.import": {
    label: "Импорт клуба",
    icon: UploadCloud,
    tone: "green",
  },
  "member.assignSubscription": {
    label: "Абонемент оформлен",
    icon: Wallet,
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
  "member.acceptInvitation": {
    label: "Принял приглашение в клуб",
    icon: UserPlus,
    tone: "green",
  },
  "member.declineInvitation": {
    label: "Отклонил приглашение",
    icon: UserMinus,
    tone: "amber",
  },
  "member.revokeInvitation": {
    label: "Приглашение отозвано",
    icon: UserMinus,
    tone: "amber",
  },
  "member.leave": {
    label: "Участник покинул клуб",
    icon: UserMinus,
    tone: "red",
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
  "member.approveFreezeRequest": {
    label: "Заявка на заморозку одобрена",
    icon: Snowflake,
    tone: "blue",
  },
  "member.declineFreezeRequest": {
    label: "Заявка на заморозку отклонена",
    icon: Snowflake,
    tone: "zinc",
  },
  "member.addDependent": {
    label: "Добавлен ребёнок",
    icon: Baby,
    tone: "green",
  },
  "guardian.actAs": {
    label: "Родитель действовал за ребёнка",
    icon: Baby,
    tone: "blue",
  },
  "guardian.addDependent": {
    label: "Родитель добавил ребёнка",
    icon: Baby,
    tone: "green",
  },
  "guardian.confirmDependent": {
    label: "Родитель подтвердил ребёнка",
    icon: Baby,
    tone: "green",
  },
  "guardian.unlinkDependent": {
    label: "Родитель отвязался от ребёнка",
    icon: UserMinus,
    tone: "amber",
  },
  "guardian.deleteDependent": {
    label: "Родитель удалил профиль ребёнка",
    icon: Trash2,
    tone: "red",
  },
  "gym.create": { label: "Зал создан", icon: MapPin, tone: "green" },
  "gym.update": { label: "Зал обновлён", icon: Pencil, tone: "indigo" },
  "gym.delete": { label: "Зал удалён", icon: Trash2, tone: "red" },
  "direction.create": { label: "Направление создано", icon: Layers, tone: "green" },
  "direction.update": { label: "Направление обновлено", icon: Pencil, tone: "indigo" },
  "direction.delete": { label: "Направление удалено", icon: Trash2, tone: "red" },
  "direction.managerAssign": {
    label: "Назначен руководитель направления",
    icon: ShieldCheck,
    tone: "green",
  },
  "direction.managerRemove": {
    label: "Снят руководитель направления",
    icon: UserMinus,
    tone: "red",
  },
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
    label: "Время в расписании добавлено",
    icon: CalendarPlus,
    tone: "green",
  },
  "group.slotUpdate": {
    label: "Время в расписании изменено",
    icon: Calendar,
    tone: "indigo",
  },
  "group.slotDelete": {
    label: "Время в расписании удалено",
    icon: Trash2,
    tone: "red",
  },
  "group.occurrenceMove": {
    label: `${cap(v.session.nom)} ${agree(v.session, "перенесена", "перенесено")}`,
    icon: Calendar,
    tone: "indigo",
  },
  "group.slotSplit": {
    label: "Расписание изменено с даты",
    icon: Calendar,
    tone: "indigo",
  },
  "group.exceptionCreate": {
    label: `Отмена ${v.session.gen} добавлена`,
    icon: CalendarOff,
    tone: "amber",
  },
  "group.exceptionUpdate": {
    label: `Отмена ${v.session.gen} изменена`,
    icon: CalendarOff,
    tone: "indigo",
  },
  "group.exceptionDelete": {
    label: `Отмена ${v.session.gen} снята`,
    icon: Calendar,
    tone: "green",
  },
  "group.substituteAssign": {
    label: `Назначена замена ${v.coach.gen}`,
    icon: UserPlus,
    tone: "blue",
  },
  "group.substituteRequest": {
    label: `${cap(v.coach.nom)} попросил провести ${v.session.acc}`,
    icon: UserPlus,
    tone: "amber",
  },
  "group.substituteApprove": {
    label: "Замена одобрена",
    icon: UserPlus,
    tone: "green",
  },
  "group.substituteDecline": {
    label: "Замена отклонена",
    icon: UserMinus,
    tone: "red",
  },
  "group.substituteCancel": {
    label: "Замена отменена",
    icon: UserMinus,
    tone: "zinc",
  },
  "booking.staffAdd": {
    label: `Ученик записан на ${v.session.acc}`,
    icon: UserPlus,
    tone: "green",
  },
  "booking.staffRemove": {
    label: `Ученик снят с ${v.session.gen}`,
    icon: UserMinus,
    tone: "amber",
  },
  "booking.setCapacity": {
    label: `Изменено число мест на ${v.session.prep}`,
    icon: Pencil,
    tone: "indigo",
  },
  "event.create": {
    label: "Событие создано",
    icon: Megaphone,
    tone: "green",
  },
  "event.update": {
    label: "Событие обновлено",
    icon: Pencil,
    tone: "indigo",
  },
  "event.delete": {
    label: "Событие удалено",
    icon: Trash2,
    tone: "red",
  },
  "event.markRegistrationPaid": {
    label: "Оплата за событие отмечена",
    icon: Wallet,
    tone: "green",
  },
  "event.unmarkRegistrationPaid": {
    label: "Отметка оплаты за событие отменена",
    icon: Wallet,
    tone: "amber",
  },
  "workspace.updateSettings": {
    label: "Настройки клуба",
    icon: ShieldCheck,
    tone: "indigo",
  },
  "workspace.updateAbout": {
    label: "Информация о клубе",
    icon: ShieldCheck,
    tone: "indigo",
  },
  "workspace.updatePublicProfile": {
    label: "Публичная страница клуба",
    icon: Globe,
    tone: "indigo",
  },
  "workspace.updatePaymentSettings": {
    label: "Настройки онлайн-оплаты",
    icon: CreditCard,
    tone: "indigo",
  },
  "payment.succeeded": {
    label: "Онлайн-оплата",
    icon: CreditCard,
    tone: "green",
  },
  "payment.refund": {
    label: "Возврат денег",
    icon: RotateCcw,
    tone: "amber",
  },
  "payment.refundDelete": {
    label: "Запись о возврате удалена",
    icon: Trash2,
    tone: "red",
  },
  "discount.create": { label: "Скидка создана", icon: Percent, tone: "green" },
  "discount.update": { label: "Скидка изменена", icon: Pencil, tone: "indigo" },
  "discount.archive": { label: "Скидка в архиве", icon: Archive, tone: "amber" },
  "discount.restore": {
    label: "Скидка возвращена из архива",
    icon: ArchiveRestore,
    tone: "blue",
  },
  "discount.delete": { label: "Скидка удалена", icon: Trash2, tone: "red" },
  "autopay.enabled": { label: "Автоплатёж включён", icon: CreditCard, tone: "green" },
  "autopay.cancelled": { label: "Автоплатёж отключён", icon: CreditCard, tone: "amber" },
  "autopay.termsAccepted": {
    label: "Новые условия автоплатежа приняты",
    icon: CreditCard,
    tone: "indigo",
  },
  "autopay.chargeFailed": { label: "Автоплатёж не прошёл", icon: CreditCard, tone: "red" },
  "workspace.rotateJoinCode": {
    label: "Код клуба сменён",
    icon: RefreshCw,
    tone: "indigo",
  },
  // The club's own life on the platform: created, offer accepted, billing,
  // modules. A new club's dashboard opens with the first two.
  "workspace.create": { label: "Клуб создан", icon: CalendarPlus, tone: "green" },
  "workspace.legalAccept": {
    label: "Принята оферта",
    icon: ShieldCheck,
    tone: "green",
  },
  "workspace.update": { label: "Клуб изменён", icon: Pencil, tone: "indigo" },
  "workspace.transferOwner": {
    label: "Клуб передан новому владельцу",
    icon: UserPlus,
    tone: "amber",
  },
  "workspace.billingUpdate": {
    label: "Тариф клуба изменён",
    icon: Wallet,
    tone: "indigo",
  },
  "workspace.billingExpire": {
    label: "Оплата клуба просрочена",
    icon: ShieldAlert,
    tone: "red",
  },
  "workspace.billingPayment": {
    label: "Оплата тарифа картой",
    icon: CreditCard,
    tone: "green",
  },
  "workspace.billingChargeFailed": {
    label: "Автосписание не прошло",
    icon: ShieldAlert,
    tone: "red",
  },
  "workspace.billingRefund": {
    label: "Возврат оплаты тарифа",
    icon: RotateCcw,
    tone: "amber",
  },
  "workspace.billingAutopay": {
    label: "Автосписание",
    icon: CreditCard,
    tone: "indigo",
  },
  "workspace.billingCardCheck": {
    label: "Привязка карты (проверочное списание)",
    icon: CreditCard,
    tone: "blue",
  },
  "workspace.billingCardRemoved": {
    label: "Карта для оплаты тарифа удалена",
    icon: Trash2,
    tone: "amber",
  },
  "workspace.billingPeriod": {
    label: "Период оплаты тарифа",
    icon: Calendar,
    tone: "indigo",
  },
  "workspace.billingArchive": {
    label: "Клуб перенесён в архив",
    icon: Lock,
    tone: "red",
  },
  "workspace.moduleUpdate": { label: "Модуль", icon: Layers, tone: "indigo" },
  "workspace.moduleSelfServe": {
    label: "Модуль подключён клубом",
    icon: Layers,
    tone: "indigo",
  },
  "workspace.forceFeature": {
    label: "Раздел клуба (платформа)",
    icon: ShieldCheck,
    tone: "amber",
  },
  "workspace.featureLock": {
    label: "Раздел закреплён платформой",
    icon: Lock,
    tone: "amber",
  },
  "workspace.featureUnlock": {
    label: "Раздел снова у клуба",
    icon: ShieldCheck,
    tone: "indigo",
  },
  "workspace.promoApply": { label: "Промо", icon: Wallet, tone: "green" },
  "workspace.onboardingHelpRequest": {
    label: "Заявка на помощь с подключением",
    icon: Megaphone,
    tone: "blue",
  },
  "workspace.onboardingHelpUpdate": {
    label: "Заявка на помощь с подключением обработана",
    icon: Megaphone,
    tone: "indigo",
  },
  "workspace.demoReset": {
    label: "Демо-клуб сброшен и создан заново",
    icon: RefreshCw,
    tone: "amber",
  },
  "auth.demoSignIn": {
    label: "Вход в демо-аккаунт по постоянному коду",
    icon: LogIn,
    tone: "zinc",
  },
  "auth.storeReviewSignIn": {
    label: "Вход аккаунта для проверки магазина приложений",
    icon: ShieldCheck,
    tone: "amber",
  },
  "member.grantStoreReviewAccess": {
    label: "Аккаунт проверки магазина добавлен в демо-клуб",
    icon: UserPlus,
    tone: "amber",
  },
  "auth.signIn": {
    label: "Вход в аккаунт",
    icon: LogIn,
    tone: "blue",
  },
  "auth.lockout": {
    label: "Вход заблокирован после неверных кодов",
    icon: Lock,
    tone: "red",
  },
  "auth.mfaEnrolled": {
    label: "Включена двухфакторная проверка входа",
    icon: ShieldCheck,
    tone: "green",
  },
  "me.export": {
    label: "Выгрузка своих данных",
    icon: Download,
    tone: "zinc",
  },
  "export.members": {
    label: "Выгрузка CSV: участники",
    icon: Download,
    tone: "amber",
  },
  "export.renewals": {
    label: "Выгрузка CSV: продления",
    icon: Download,
    tone: "amber",
  },
  "export.attendance": {
    label: "Выгрузка CSV: посещаемость",
    icon: Download,
    tone: "amber",
  },
  "export.revenue": {
    label: "Выгрузка CSV: выручка",
    icon: Download,
    tone: "amber",
  },
  "export.payments": {
    label: "Выгрузка CSV: платежи",
    icon: Download,
    tone: "amber",
  },
  "platform.accessClub": {
    label: "Платформа открыла клуб",
    icon: ShieldAlert,
    tone: "amber",
  },
  "content.report": {
    label: "Жалоба на контент",
    icon: Activity,
    tone: "amber",
  },
  "ai.tokenCreate": {
    label: "Создан токен ИИ-ассистента",
    icon: Bot,
    tone: "green",
  },
  "ai.tokenRevoke": {
    label: "Отозван токен ИИ-ассистента",
    icon: Bot,
    tone: "red",
  },
  "ai.personalDataAccept": {
    label: "Разрешена передача персональных данных ИИ-сервису",
    icon: ShieldAlert,
    tone: "amber",
  },
  "ai.toolCall": {
    label: "Запрос ИИ-ассистента",
    icon: Bot,
    tone: "indigo",
  },
  "ai.chatEnable": {
    label: "Включён чат ИИ-ассистента",
    icon: ShieldAlert,
    tone: "amber",
  },
  "ai.chatQuestion": {
    label: "Вопрос ИИ-ассистенту в админке",
    icon: Bot,
    tone: "indigo",
  },
})

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
  event: "Событие",
  direction: "Направление",
  aiToken: "Токен ИИ-ассистента",
  aiChat: "Чат ИИ-ассистента",
}

// Unknown types (a newer server) get a neutral word, never the raw slug.
export const targetTypeLabel = (targetType: string): string =>
  TARGET_LABEL[targetType] ?? "Объект"

// An action this admin build has no label for: named by its area.
export const unknownActionMeta = (action: string): ActionMeta => {
  const area = ACTION_CATEGORY_LABELS[action.split(".")[0]]
  return {
    label: area ? `Изменение в разделе «${area}»` : "Изменение в клубе",
    icon: Activity,
    tone: "zinc",
  }
}

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

// Metadata is written by the server for machines: ids, list positions,
// request plumbing, camelCase field names, enum values. A person sees only
// what has a Russian label here: a key without a label, an id, an enum value
// without a translation is left out rather than shown raw.

export const META_KEY_LABEL: Record<string, string> = {
  email: "Эл. почта",
  applicantEmail: "Эл. почта",
  isNew: "Новый пользователь",
  added: "Добавлено",
  removed: "Убрано",
  invited: "Приглашено",
  skipped: "Пропущено",
  invalid: "С ошибками",
  accessUntil: "Доступ до",
  accessUntilCleared: "Доступ без ограничения",
  title: "Название",
  name: "Название",
  slug: "Адрес страницы",
  key: "Адрес клуба",
  address: "Адрес",
  reason: "Причина",
  dayOfWeek: "День недели",
  startTime: "Начало",
  durationMin: "Длительность, мин",
  fromDate: "С",
  untilDate: "По",
  sessionDate: "Дата",
  days: "Дней",
  returnedDays: "Возвращено дней",
  comment: "Комментарий",
  requestedFromDate: "Запрошено с",
  requestedDays: "Запрошено дней",
  planName: "Тариф",
  itemName: "Позиция",
  amount: "Сумма",
  paymentAmount: "Сумма платежа",
  refundedTotal: "Возвращено",
  listPrice: "Цена по тарифу",
  // A sale's discount (member.assignSubscription, member.markSubscriptionPaid,
  // event.markRegistrationPaid, payment.succeeded): the named part and the
  // one-off remainder the actor set.
  discountName: "Скидка",
  discountAmount: "Размер скидки",
  oneOff: "Разовая скидка",
  // A discount's snapshot (discount.create / archive / restore / delete);
  // `name` and the size share the labels above and parseMetadata.
  code: "Промокод",
  isFamily: "Семейная",
  allPlans: "Все тарифы",
  plans: "Тарифы",
  events: "Платные события",
  startsOn: "Действует с",
  endsOn: "Действует до",
  maxUses: "Не больше раз",
  oncePerMember: "Один раз на ученика",
  paid: "Оплачено",
  periodMonths: "Месяцев",
  startDate: "Начало",
  endDate: "Окончание",
  startAt: "Начало",
  endAt: "Окончание",
  publishedAt: "Публикация",
  timezone: "Часовой пояс",
  changes: "Изменения",
  fields: "Изменено",
  memberCount: "Участников",
  orphanedGroupCount: "Групп осталось без зала",
  scheduleText: "Расписание",
  fromRoleName: "Роль до",
  toRoleName: "Роль после",
  type: "Тип клуба",
  isActive: "Клуб активен",
  ownerEmail: "Владелец",
  toOwnerEmail: "Новый владелец",
  ownerCreated: "Создан аккаунт владельца",
  ownerAccountCreated: "Создан аккаунт владельца",
  clubName: "Клуб",
  addedVideos: "Добавлено видео",
  membersChanged: "Состав изменён",
  cleared: "Заметки очищены",
  count: "Количество",
  from: "С",
  to: "По",
  // The payments journal's filters (export.payments); `markedById` and
  // `directionId` stay ids on the server, so they are left out.
  method: "Способ оплаты",
  kind: "Показывать",
  q: "Поиск",
  discounted: "Со скидкой",
  // A refund (payment.refund / payment.refundDelete); amount, currency,
  // method, reason and provider share the labels above.
  target: "Возврат за",
  registrationCancelled: "Запись на событие отменена",
  lockoutMinutes: "Блокировка, мин",
  provider: "Платёжная система",
  previousProvider: "Платёжная система до",
  activationError: "Не оформлено автоматически",
  secretKeyChanged: "Секретный ключ изменён",
  webhookSecretChanged: "Секрет вебхука изменён",
  disconnected: "Отключено",
  // Member autopay (autopay.* events, payment.succeeded, the payment
  // settings); `reason`, `planName`, `amount` and `currency` share the labels
  // above, an accepted change is `from` → `to` of amount / days / classes.
  autopayEnabled: "Автоплатежи для учеников",
  autopay: "Автоплатёж",
  source: "Кто отключил",
  termsAmount: "Сумма автоплатежа",
  cardLast4: "Карта, последние цифры",
  consentVersion: "Редакция условий автоплатежа",
  durationDays: "Дней",
  classCount: "Занятий",
  attempt: "Попытка",
  nextAttemptAt: "Следующая попытка",
  needsActionReason: "Остановлен",
  currency: "Валюта",
  fileName: "Файл",
  rows: "Строк",
  create: "Новых участников",
  update: "Обновлено",
  invite: "Приглашено",
  skip: "Пропущено",
  error: "С ошибками",
  children: "Детей",
  groupMemberships: "Мест в группах",
  subscriptions: "Абонементов",
  ranks: "Поясов",
  createdGyms: "Создано залов",
  createdDirections: "Создано направлений",
  createdGroups: "Создано групп",
  createdPlans: "Создано тарифов",
  createdRanks: "Создано поясов",
  groups: "Групп",
  members: "Участников",
  visits: "Посещений",
  contacts: "Контактов",
  links: "Ссылок",
  hasRules: "Правила клуба",
  hasLogo: "Логотип",
  isListed: "В каталоге клубов",
  route: "Раздел",
  tool: "Инструмент",
  tools: "Инструменты",
  args: "Параметры",
  isError: "Ошибка",
  tokenName: "Токен",
  dataMode: "Режим данных",
  scopes: "Права",
  expiresAt: "Действует до",
  warningVersion: "Редакция предупреждения",
  offerVersion: "Редакция оферты",
  dpaVersion: "Редакция соглашения",
  question: "Вопрос (как ушёл ИИ-сервису)",
  toolErrors: "Ошибок инструментов",
  model: "Модель",
  inputTokens: "Токенов на входе",
  outputTokens: "Токенов на выходе",
  role: "Роль в группе",
  action: "Действие",
  // Ids the server resolves to names before sending the log
  // (`AuditService.list` → `humanise`); an unresolved one stays an id and is
  // left out. `coachId` is named in the club's words in `parseMetadata`.
  userId: "Участник",
  memberId: "Участник",
  studentId: "Участник",
  targetUserId: "Участник",
  fromUserId: "Участник",
  toUserId: "Участник",
  // payment.succeeded: the guardian who paid online for a child.
  payerUserId: "Плательщик",
  gymId: "Зал",
  groupId: "Группа",
  eventId: "Событие",
  videoId: "Видео",
  courseId: "Курс",
  playlistId: "Курс",
  slotId: "Время в расписании",
  exceptionId: "Отмена",
  fromRoleId: "Роль до",
  toRoleId: "Роль после",
  chapterId: "Глава",
  direction: "Направление",
}

// Entity fields named in `fields` (what an edit touched) and as keys of
// `changes` (what an edit set).
const FIELD_LABEL: Record<string, string> = {
  title: "название",
  name: "название",
  slug: "адрес страницы",
  description: "описание",
  thumbnailUrl: "обложка",
  isPublic: "видимость",
  tagIds: "теги",
  tags: "теги",
  categoryIds: "категории",
  playlistIds: "курсы",
  playlistId: "курс",
  status: "статус",
  accessLevel: "доступ",
  level: "уровень",
  lockedProgression: "порядок прохождения",
  publishedAt: "дата публикации",
  dayOfWeek: "день недели",
  startTime: "время начала",
  durationMin: "длительность",
  effectiveFrom: "действует с",
  effectiveUntil: "действует до",
  capacity: "вместимость",
  slotId: "время",
  fromDate: "начало",
  untilDate: "конец",
  reason: "причина",
  link: "ссылка",
  startAt: "начало",
  endAt: "окончание",
  timezone: "часовой пояс",
  gymId: "зал",
  address: "адрес",
  firstname: "имя",
  lastname: "фамилия",
  email: "эл. почта",
  dateOfBirth: "дата рождения",
  coachSeesAllGroups: "доступ ко всем группам",
  announcementsEnabled: "раздел «Объявления»",
  ranksEnabled: "раздел «Пояса»",
  leaderboardEnabled: "рейтинг",
  attendanceEnabled: "раздел «Посещаемость»",
  subscriptionEnabled: "раздел «Абонемент»",
  scheduleEnabled: "раздел «Расписание»",
  groupsEnabled: "раздел «Группы»",
  eventsEnabled: "раздел «События»",
  // A discount (discount.update `changes`: { field: { from, to } }).
  kind: "вид скидки",
  value: "размер",
  currency: "валюта",
  code: "промокод",
  isFamily: "семейная",
  allPlans: "все тарифы",
  plans: "тарифы",
  events: "платные события",
  startsOn: "действует с",
  endsOn: "действует до",
  maxUses: "не больше раз",
  oncePerMember: "один раз на ученика",
  // A tariff and the payment settings (member autopay).
  autopayAvailable: "продление автоплатежом",
  autopayEnabled: "автоплатежи для учеников",
  // «Настройки → Уведомления → Ученикам».
  birthdayGreetingsEnabled: "поздравления с днём рождения",
}

// Course edits naming a video or a chapter. The server resolves most of them
// to the title (shown with `label`); one it can't resolve stays an id, and the
// event then says only what happened (`label` + `fallback`).
const COURSE_ITEM_CHANGE: Record<string, { label: string; fallback: string }> = {
  movedVideo: { label: "Перемещено видео", fallback: "Видео перемещено" },
  removedVideo: { label: "Убрано из курса видео", fallback: "Видео убрано из курса" },
  updatedVideo: { label: "Изменено видео", fallback: "Видео изменено в курсе" },
  addedVideo: { label: "Добавлено видео", fallback: "Видео добавлено" },
  createdChapter: { label: "Добавлена глава", fallback: "Глава добавлена" },
  addedChapter: { label: "Добавлена глава", fallback: "Глава добавлена" },
  deletedChapter: { label: "Удалена глава", fallback: "Глава удалена" },
  removedChapter: { label: "Удалена глава", fallback: "Глава удалена" },
  renamedChapter: { label: "Переименована глава", fallback: "Глава переименована" },
  movedChapter: { label: "Перемещена глава", fallback: "Глава перемещена" },
}

const ENUM_LABEL: Record<string, Record<string, string>> = {
  action: {
    setPublic: "открыты всем",
    setPrivate: "скрыты",
    addCategory: "добавлена категория",
    removeCategory: "убрана категория",
    delete: "удалены",
  },
  type: {
    GRAPPLING: "единоборства",
    FITNESS: "фитнес",
    YOGA: "йога",
    CUSTOM: "другое",
  },
  dataMode: AI_DATA_MODE_LABEL,
  scopes: { read: "чтение", actions: "действия" },
  currency: { RUB: "₽", USD: "$", EUR: "€" },
  method: {
    CASH: "наличные",
    TRANSFER: "перевод",
    CARD: "карта в клубе",
    ONLINE: "онлайн",
    NONE: "не указан",
  },
  kind: {
    payment: "только оплаты",
    refund: "только возвраты",
    PERCENT: "процент",
    FIXED: "сумма",
  },
  target: {
    abonement: "абонемент",
    ticket: "событие",
    unapplied: "онлайн-оплату без зачисления",
  },
  // Who switched a member's autopay off (autopay.cancelled).
  source: { MEMBER: "ученик", STAFF: "сотрудник клуба", SYSTEM: "автоматически" },
  // payment.succeeded of an autopay checkout or renewal charge.
  autopay: { setup: "подключён при оплате", charge: "списание" },
  // Why a member's autopay stopped (autopay.chargeFailed).
  needsActionReason: {
    CHARGE_FAILED: "четыре отказа подряд",
    CARD_EXPIRED: "срок действия карты истёк",
    TERMS_CHANGED: "условия тарифа изменились",
    GRANT_REFUSED: "абонемент не оформлен",
  },
  provider: PROVIDER_LABEL,
  previousProvider: PROVIDER_LABEL,
  dayOfWeek: { "1": "Пн", "2": "Вт", "3": "Ср", "4": "Чт", "5": "Пт", "6": "Сб", "7": "Вс" },
  // The AI assistant's tools (server `features/mcp/tools`).
  tool: AI_TOOL_LABEL,
  tools: AI_TOOL_LABEL,
}

// The club area a platform request opened, by the path segment after the
// club id (`/workspaces/:workspaceId/<segment>/…`).
const ROUTE_SECTION: Record<string, string> = {
  members: "Ученики",
  groups: "Группы",
  gyms: "Залы",
  schedule: "Расписание",
  sessions: "Расписание",
  plans: "Абонементы",
  subscriptions: "Абонементы",
  payments: "Платежи",
  settings: "Настройки",
  analytics: "Отчёты",
  events: "События",
  announcements: "Объявления",
  videos: "Курсы и видео",
  playlists: "Курсы и видео",
  audit: "История изменений",
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

const isId = (value: unknown): boolean =>
  typeof value === "string" && UUID_RE.test(value)

// The coach field is named in the club's words.
const fieldLabel = (name: string, v: ClubVocabulary): string | undefined =>
  name === "coachId" ? v.coach.nom : FIELD_LABEL[name]

const fieldList = (names: string[], v: ClubVocabulary): string | null => {
  const known = [...new Set(names.map((n) => fieldLabel(n, v)).filter(Boolean))]
  const unknown = names.filter((n) => !fieldLabel(n, v)).length
  if (known.length === 0) {
    return unknown > 0 ? `${unknown} ${pluralRu(unknown, "поле", "поля", "полей")}` : null
  }
  return unknown > 0 ? `${known.join(", ")} и ещё ${unknown}` : known.join(", ")
}

const changeList = (changes: Record<string, unknown>, v: ClubVocabulary): string | null => {
  const parts = Object.entries(changes).flatMap(([k, value]) => {
    const label = fieldLabel(k, v)
    if (!label) return []
    // An edit's before → after (discount.update).
    if (value && typeof value === "object" && "from" in value && "to" in value) {
      const word = (x: unknown): string =>
        typeof x === "boolean" ? (x ? "да" : "нет") : (formatMetaValue(k, x, v) ?? "—")
      return [`${label}: ${word(value.from)} → ${word(value.to)}`]
    }
    if (typeof value === "boolean") return [`${label}: ${value ? "вкл." : "выкл."}`]
    if (value === null || value === "") return [`${label}: убрано`]
    if (isId(value) || typeof value !== "string") return [`${label}: изменено`]
    // A calendar day (a date of birth) reads «04.05.2016».
    return [`${label}: ${DATE_RE.test(value) ? value.split("-").reverse().join(".") : value}`]
  })
  return parts.length > 0 ? parts.join("; ") : null
}

// One value in words, or null when there is nothing a person can read.
const formatMetaValue = (key: string, value: unknown, v: ClubVocabulary): string | null => {
  if (value === null || value === undefined || value === "") return null
  const enumLabels = ENUM_LABEL[key]
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    if (value.every(isId)) return String(value.length)
    const items = value
      .map((item) => formatMetaValue(key, item, v))
      .filter((item): item is string => item !== null)
    return items.length > 0 ? items.join(", ") : null
  }
  if ((key === "tool" || key === "tools") && value === "coach_stats") return cap(v.coach.nomPl)
  if (enumLabels) return enumLabels[String(value)] ?? null
  if (typeof value === "boolean") return value ? "да" : "нет"
  if (typeof value === "number") return value.toLocaleString("ru-RU")
  if (typeof value === "string") {
    if (isId(value)) return null
    if (DATE_TIME_RE.test(value)) return formatDate(value)
    if (DATE_RE.test(value)) return value.split("-").reverse().join(".")
    return value
  }
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>).flatMap(([k, val]) => {
      const label = META_KEY_LABEL[k]
      const text = label ? formatMetaValue(k, val, v) : null
      return label && text ? [`${label}: ${text}`] : []
    })
    return parts.length > 0 ? parts.join("; ") : null
  }
  return null
}

// A group coach added/removed: `{ userId, role }`; a roster sync: user ids.
const groupPeopleValue = (value: unknown, v: ClubVocabulary): string | null => {
  if (Array.isArray(value)) {
    return value.length > 0
      ? `${value.length} ${pluralRu(value.length, "участник", "участника", "участников")}`
      : null
  }
  if (value && typeof value === "object" && "role" in value) {
    const role = value.role === "primary" ? v.coach.nom : `помощник ${v.coach.gen}`
    const who = "userId" in value && typeof value.userId === "string" && !isId(value.userId)
      ? value.userId
      : null
    return who ? `${who} — ${role}` : cap(role)
  }
  return null
}

const routeSection = (route: unknown): string | null => {
  if (typeof route !== "string") return null
  const segment = route.match(/^\/workspaces\/[^/]+\/([^/?]+)/)?.[1]
  return segment ? (ROUTE_SECTION[segment] ?? null) : null
}

export const parseMetadata = (
  metadata: unknown,
  vocabulary: ClubVocabulary,
): Array<{ key: string; label: string; value: string }> => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return []
  const meta = metadata as Record<string, unknown>
  // A discount's snapshot (discount.create / archive / restore / delete): the
  // size reads «−10%» / «−500 ₽»; its kind, currency and active flag are
  // folded into that or said by the action.
  const discountKind = meta.kind === "PERCENT" || meta.kind === "FIXED" ? meta.kind : null
  return Object.entries(meta).flatMap(([key, raw]) => {
    if (discountKind && (key === "kind" || key === "currency" || key === "isActive")) return []
    // A sale without a named discount records 0: nothing to say.
    if (key === "discountAmount" && raw === 0) return []
    if (discountKind && key === "value" && typeof raw === "number") {
      const unit =
        discountKind === "PERCENT"
          ? "%"
          : ` ${ENUM_LABEL.currency[String(meta.currency)] ?? String(meta.currency ?? "")}`
      return [{ key, label: "Размер", value: `−${raw.toLocaleString("ru-RU")}${unit}` }]
    }
    const courseItem = COURSE_ITEM_CHANGE[key]
    if (courseItem) {
      return typeof raw === "string" && !isId(raw)
        ? [{ key, label: courseItem.label, value: raw }]
        : [{ key, label: courseItem.fallback, value: "" }]
    }
    // The role name already says it; the resolved role id would repeat it.
    if (key === "toRoleId" && "toRoleName" in metadata) return []
    const label = key === "coachId" ? cap(vocabulary.coach.nom) : META_KEY_LABEL[key]
    if (!label) return []
    let value: string | null
    if (key === "fields") {
      value = Array.isArray(raw) ? fieldList(raw.map(String), vocabulary) : null
    } else if (key === "changes") {
      value =
        raw && typeof raw === "object"
          ? changeList(raw as Record<string, unknown>, vocabulary)
          : null
    } else if ((key === "added" || key === "removed") && typeof raw !== "number") {
      value = groupPeopleValue(raw, vocabulary)
    } else if (["toRoleName", "fromRoleName", "toRoleId", "fromRoleId"].includes(key)) {
      value = typeof raw === "string" && !isId(raw) ? formatRoleName(raw, vocabulary) : null
    } else if (key === "route") {
      value = routeSection(raw)
    } else {
      value = formatMetaValue(key, raw, vocabulary)
    }
    return value ? [{ key, label, value }] : []
  })
}

// Human labels for the action-family filter. Actions are "<entity>.<verb>",
// so filtering by the entity prefix scopes the journal to one area.
export const ACTION_CATEGORY_LABELS: Record<string, string> = {
  video: "Видео",
  playlist: "Курсы",
  member: "Участники",
  club: "Импорт клуба",
  guardian: "Родители",
  group: "Группы",
  booking: "Запись учеников",
  gym: "Залы",
  direction: "Направления",
  event: "События",
  workspace: "Настройки",
  content: "Контент",
  export: "Выгрузки",
  platform: "Платформа",
  payment: "Платежи",
  discount: "Скидки",
  autopay: "Автоплатежи",
  ai: "ИИ-ассистент",
}

// Account-level families are recorded without a club (workspaceId null), so
// the club journal never contains them — offering them as a filter would only
// ever show an empty list. Their labels above still render elsewhere.
const ACCOUNT_LEVEL_CATEGORIES: Record<string, true> = { auth: true, me: true }

export const ACTION_CATEGORIES = Array.from(
  new Set(
    Object.keys(actionMetaFor(vocabularyForWorkspaceType(null))).map(
      (action) => action.split(".")[0],
    ),
  ),
)
  .filter((category) => ACCOUNT_LEVEL_CATEGORIES[category] !== true)
  .sort((a, b) =>
    (ACTION_CATEGORY_LABELS[a] ?? a).localeCompare(
      ACTION_CATEGORY_LABELS[b] ?? b,
      "ru",
    ),
  )
