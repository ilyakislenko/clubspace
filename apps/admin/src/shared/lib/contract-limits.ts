import {
  CreateOrgAnnouncementInputSchema,
  CreateOrgEventInputSchema,
  CreateOrgLadderTemplateInputSchema,
  CreateOrgLadderTemplateLevelInputSchema,
  CreatePlatformOrganizationInputDtoSchema,
  InviteClubToOrganizationInputDtoSchema,
  UpdateOrgAnnouncementInputSchema,
  UpdateOrgEventInputSchema,
  UpdateOrgLadderTemplateInputSchema,
  UpdateOrgLadderTemplateLevelInputSchema,
  UpdateOrganizationInputDtoSchema,
  CreateTournamentDivisionsInputSchema,
  RecordTournamentMatchResultInputSchema,
  RecordTournamentWeighInInputSchema,
  UpdateOrgTournamentInputSchema,
  UpdateTournamentDivisionInputSchema,
  ApproveSubscriptionFreezeRequestInputSchema,
  AskAiChatInputSchema,
  AddPayrollAdjustmentInputSchema,
  AddVideoReviewCommentInputSchema,
  AssignSubscriptionInputSchema,
  CancelMemberAutopayInputSchema,
  CreateAiTokenInputSchema,
  CreateAchievementInputSchema,
  CreateAnnouncementInputSchema,
  CreateClubLogoUploadInputSchema,
  CreateDirectionInputSchema,
  CreateDiscountInputSchema,
  CreateLeadInputSchema,
  CreateEventInputSchema,
  CreateGroupBodySchema,
  CreateGymBodySchema,
  CreateLadderInputSchema,
  CreateLevelInputSchema,
  CreatePlanInputSchema,
  CreateRankGradingInputSchema,
  CreateRefundInputSchema,
  ClosePersonalTrainingInputSchema,
  DeclineSubscriptionFreezeRequestInputSchema,
  FreezeSubscriptionInputSchema,
  LogAtRiskContactInputSchema,
  PreviewClubMessageInputSchema,
  PromoteMemberInputSchema,
  ProposePersonalTrainingTimeInputSchema,
  RejectPendingMemberInputSchema,
  SendClubMessageInputSchema,
  SetLeadStatusInputSchema,
  UpdateLeadInputSchema,
  ReopenPayrollMonthInputSchema,
  MarkSubscriptionPaidInputSchema,
  MarkEventRegistrationPaidInputSchema,
  SetCoachRateInputSchema,
  SetClassCapacityInputSchema,
  UpdateAchievementInputSchema,
  UpdateAnnouncementInputSchema,
  UpdateClubAboutInputSchema,
  UpdateClubPublicProfileInputSchema,
  UpdateDirectionInputSchema,
  UpdateDiscountInputSchema,
  UpdateEventInputSchema,
  UpdateGroupBodySchema,
  UpdateGymBodySchema,
  UpdateLadderInputSchema,
  UpdateLevelInputSchema,
  UpdateMemberNotesBodySchema,
  UpdateMeInputSchema,
  UpdateMemberProfileBodySchema,
  UpdatePlanInputSchema,
  UpdateRankGradingInputSchema,
  UpdateSlotInputSchema,
  UpdateWorkspaceSettingsBodySchema,
} from "@clubspace/api-client/schemas"

// Field limits of the admin forms, read from the request-body JSON schemas
// generated from the server contract (open-api.json → nx types:generate →
// libs/api-client/src/openapi/schemas). A form never retypes a server rule:
// it takes `FORM_LIMITS.<form>.<field>.min/.max` for its check, its error
// text and its `maxLength` attribute.
//
// Each limit names every body the form submits that field in (create and
// update). It is the strictest of them, so the form never sends what one of
// them refuses; contract-limits.spec.ts fails when they disagree.

export type Body = { readonly properties: { readonly [field: string]: unknown } }
type Bodies = readonly [Body, ...Body[]]
type FieldOf<B extends Bodies> = keyof B[number]["properties"] & string

// text: string length; int: whole-number value; items: array length.
export type LimitKind = "text" | "int" | "items"
export type Limit = { readonly min: number; readonly max: number }
export type ContractLimit = Limit & {
  readonly kind: LimitKind
  readonly field: string
  readonly bodies: Bodies
}

type FieldSchema = {
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  // OpenAPI 3.0 writes `exclusiveMinimum: true` beside `minimum`; zod's
  // nullable numbers come out 3.1-style, the bound itself in `exclusiveMinimum`.
  exclusiveMinimum?: boolean | number
  exclusiveMaximum?: boolean | number
  minItems?: number
  maxItems?: number
}

const intBound = (
  inclusive: number | undefined,
  exclusive: boolean | number | undefined,
  step: 1 | -1,
): number | undefined => {
  if (typeof exclusive === "number") return exclusive + step
  if (inclusive === undefined) return undefined
  return exclusive === true ? inclusive + step : inclusive
}

// The limit one body sets on `field`; throws when the contract has none, so a
// bound dropped or renamed on the server fails the spec instead of silently
// lifting the form's check.
export const readLimit = (kind: LimitKind, body: Body, field: string): Limit => {
  const s = body.properties[field] as FieldSchema | undefined
  const [min, max] =
    s === undefined
      ? [undefined, undefined]
      : kind === "text"
        ? [s.minLength ?? 0, s.maxLength]
        : kind === "items"
          ? [s.minItems ?? 0, s.maxItems]
          : [intBound(s.minimum, s.exclusiveMinimum, 1), intBound(s.maximum, s.exclusiveMaximum, -1)]
  if (min === undefined || max === undefined) {
    throw new Error(`Contract sets no ${kind} limit on "${field}"`)
  }
  return { min, max }
}

const limit =
  (kind: LimitKind) =>
  <const B extends Bodies>(bodies: B, field: FieldOf<B>): ContractLimit => {
    const each = bodies.map((b) => readLimit(kind, b, field))
    return {
      kind,
      field,
      bodies,
      min: Math.max(...each.map((l) => l.min)),
      max: Math.min(...each.map((l) => l.max)),
    }
  }
const text = limit("text")
const int = limit("int")
const items = limit("items")

const PLAN = [CreatePlanInputSchema, UpdatePlanInputSchema] as const
const GROUP = [CreateGroupBodySchema, UpdateGroupBodySchema] as const
const GYM = [CreateGymBodySchema, UpdateGymBodySchema] as const
const EVENT = [CreateEventInputSchema, UpdateEventInputSchema] as const
const ANNOUNCEMENT = [CreateAnnouncementInputSchema, UpdateAnnouncementInputSchema] as const
const DIRECTION = [CreateDirectionInputSchema, UpdateDirectionInputSchema] as const
const LADDER = [CreateLadderInputSchema, UpdateLadderInputSchema] as const
const LEVEL = [CreateLevelInputSchema, UpdateLevelInputSchema] as const
const GRADING = [CreateRankGradingInputSchema, UpdateRankGradingInputSchema] as const
const ACHIEVEMENT = [CreateAchievementInputSchema, UpdateAchievementInputSchema] as const
const PROFILE = [UpdateClubPublicProfileInputSchema] as const
const ABOUT = [UpdateClubAboutInputSchema] as const
const ABOUT_CONTACT = [UpdateClubAboutInputSchema.properties.contacts.items] as const
const ABOUT_LINK = [UpdateClubAboutInputSchema.properties.links.items] as const
// The direct freeze and approving a member's request share FreezeForm.
const FREEZE = [FreezeSubscriptionInputSchema, ApproveSubscriptionFreezeRequestInputSchema] as const
const DISCOUNT = [CreateDiscountInputSchema, UpdateDiscountInputSchema] as const
// ProfileEditForm: a member's profile (staff) and the own-profile dialog.
const MEMBER_PROFILE = [UpdateMemberProfileBodySchema] as const
const NAMES = [UpdateMemberProfileBodySchema, UpdateMeInputSchema] as const
// «Добавить заявку» and «Изменить данные» of a trial request.
const LEAD = [CreateLeadInputSchema, UpdateLeadInputSchema] as const
const ORG_ANNOUNCEMENT = [CreateOrgAnnouncementInputSchema, UpdateOrgAnnouncementInputSchema] as const
const ORG_EVENT = [CreateOrgEventInputSchema, UpdateOrgEventInputSchema] as const
const ORG_TEMPLATE = [CreateOrgLadderTemplateInputSchema, UpdateOrgLadderTemplateInputSchema] as const
const TEMPLATE_LEVEL = [CreateOrgLadderTemplateLevelInputSchema, UpdateOrgLadderTemplateLevelInputSchema] as const
// «Добавить категории» (one row per weight) and «Изменить категорию».
const DIVISION = [CreateTournamentDivisionsInputSchema.properties.rows.items, UpdateTournamentDivisionInputSchema] as const

export const FORM_LIMITS = {
  plan: {
    name: text(PLAN, "name"),
    currency: text(PLAN, "currency"),
    price: int(PLAN, "price"),
    durationDays: int(PLAN, "durationDays"),
    classCount: int(PLAN, "classCount"),
  },
  group: {
    name: text(GROUP, "name"),
    capacity: int(GROUP, "capacity"),
    bookingWindowDays: int(GROUP, "bookingWindowDays"),
    bookingCancelHours: int(GROUP, "bookingCancelHours"),
  },
  gym: {
    name: text(GYM, "name"),
    address: text(GYM, "address"),
  },
  event: {
    title: text(EVENT, "title"),
    hostName: text(EVENT, "hostName"),
    link: text(EVENT, "link"),
    description: text(EVENT, "description"),
    currency: text(EVENT, "currency"),
    price: int(EVENT, "price"),
    capacity: int(EVENT, "capacity"),
  },
  announcement: {
    title: text(ANNOUNCEMENT, "title"),
    body: text(ANNOUNCEMENT, "body"),
  },
  direction: {
    name: text(DIRECTION, "name"),
    icon: text(DIRECTION, "icon"),
    order: int(DIRECTION, "order"),
  },
  ladder: {
    name: text(LADDER, "name"),
    audience: text(LADDER, "audience"),
  },
  level: {
    name: text(LEVEL, "name"),
    color: text(LEVEL, "color"),
    maxStripes: int(LEVEL, "maxStripes"),
    minVisits: int(LEVEL, "minVisits"),
    minWeeks: int(LEVEL, "minWeeks"),
  },
  promote: {
    stripes: int([PromoteMemberInputSchema] as const, "stripes"),
    note: text([PromoteMemberInputSchema] as const, "note"),
  },
  grading: {
    title: text(GRADING, "title"),
    feeAmount: int(GRADING, "feeAmount"),
    feeCurrency: text(GRADING, "feeCurrency"),
  },
  achievement: {
    name: text(ACHIEVEMENT, "name"),
    icon: text(ACHIEVEMENT, "icon"),
    description: text(ACHIEVEMENT, "description"),
    threshold: int(ACHIEVEMENT, "threshold"),
  },
  clubProfile: {
    slug: text(PROFILE, "slug"),
    city: text(PROFILE, "city"),
    description: text(PROFILE, "description"),
    logoBytes: int([CreateClubLogoUploadInputSchema] as const, "contentLength"),
    // «Заявки на пробное с сайта»: the operator named in the consent text.
    pdOperatorName: text(PROFILE, "pdOperatorName"),
    pdOperatorAddress: text(PROFILE, "pdOperatorAddress"),
  },
  clubAbout: {
    contacts: items(ABOUT, "contacts"),
    contactLabel: text(ABOUT_CONTACT, "label"),
    contactPhone: text(ABOUT_CONTACT, "phone"),
    links: items(ABOUT, "links"),
    linkLabel: text(ABOUT_LINK, "label"),
    linkUrl: text(ABOUT_LINK, "url"),
    rules: text(ABOUT, "rules"),
  },
  bookingSettings: {
    windowDays: int([UpdateWorkspaceSettingsBodySchema] as const, "bookingWindowDays"),
    cancelHours: int([UpdateWorkspaceSettingsBodySchema] as const, "bookingCancelHours"),
  },
  // One class (date) of a slot, and the slot itself (every class).
  classCapacity: {
    capacity: int([SetClassCapacityInputSchema] as const, "capacity"),
  },
  slotCapacity: {
    capacity: int([UpdateSlotInputSchema] as const, "capacity"),
  },
  freeze: {
    days: int(FREEZE, "days"),
    reason: text(FREEZE, "reason"),
    declineComment: text([DeclineSubscriptionFreezeRequestInputSchema] as const, "comment"),
  },
  payment: {
    // Paid at the sale of an abonement.
    saleAmount: int([AssignSubscriptionInputSchema] as const, "amountPaid"),
    // «Отметить оплату» later.
    paidAmount: int([MarkSubscriptionPaidInputSchema] as const, "amount"),
    // «Отметить оплату» of an event ticket.
    ticketAmount: int([MarkEventRegistrationPaidInputSchema] as const, "amount"),
  },
  // «Абонементы → Скидки». The percent's 1–100 is a `superRefine` the
  // contract can't carry (CreateDiscountInput), so the form keeps it.
  discount: {
    name: text(DISCOUNT, "name"),
    value: int(DISCOUNT, "value"),
    code: text(DISCOUNT, "code"),
    planIds: items(DISCOUNT, "planIds"),
    maxUses: int(DISCOUNT, "maxUses"),
  },
  refund: {
    // Also capped by what is left of the sale (RefundForm), as the server does.
    amount: int([CreateRefundInputSchema] as const, "amount"),
    reason: text([CreateRefundInputSchema] as const, "reason"),
  },
  // «Отключить автоплатёж» at the member's request (MemberAutopayBlock).
  autopayCancel: {
    reason: text([CancelMemberAutopayInputSchema] as const, "reason"),
  },
  // «Ученики → Заявки» decisions.
  joinReject: {
    comment: text([RejectPendingMemberInputSchema] as const, "comment"),
  },
  personalPropose: {
    durationMin: int([ProposePersonalTrainingTimeInputSchema] as const, "durationMin"),
    comment: text([ProposePersonalTrainingTimeInputSchema] as const, "comment"),
  },
  personalClose: {
    comment: text([ClosePersonalTrainingInputSchema] as const, "comment"),
  },
  videoComment: {
    text: text([AddVideoReviewCommentInputSchema] as const, "text"),
  },
  profile: {
    firstname: text(NAMES, "firstname"),
    lastname: text(NAMES, "lastname"),
    email: text(MEMBER_PROFILE, "email"),
    phone: text(MEMBER_PROFILE, "phone"),
  },
  memberNotes: {
    notes: text([UpdateMemberNotesBodySchema] as const, "notes"),
  },
  callNote: {
    note: text([LogAtRiskContactInputSchema] as const, "note"),
  },
  // «Новое сообщение»: the groups go to the preview and the send alike.
  clubMessage: {
    title: text([SendClubMessageInputSchema] as const, "title"),
    body: text([SendClubMessageInputSchema] as const, "body"),
    groupIds: items([PreviewClubMessageInputSchema, SendClubMessageInputSchema] as const, "groupIds"),
  },
  aiChat: {
    question: text([AskAiChatInputSchema] as const, "question"),
  },
  aiToken: {
    name: text([CreateAiTokenInputSchema] as const, "name"),
  },
  // «Отчёты → Выплаты»: the coach panel's rate and adjustment forms, and the
  // reason a closed month is reopened. A zero adjustment is a refine the
  // contract can't carry (AddPayrollAdjustmentInput), so the form keeps it.
  coachRate: {
    fixedMonthly: int([SetCoachRateInputSchema] as const, "fixedMonthly"),
    perClass: int([SetCoachRateInputSchema] as const, "perClass"),
    perClassMinStudents: int([SetCoachRateInputSchema] as const, "perClassMinStudents"),
    perStudent: int([SetCoachRateInputSchema] as const, "perStudent"),
    revenueBp: int([SetCoachRateInputSchema] as const, "revenueBp"),
  },
  payrollAdjustment: {
    amount: int([AddPayrollAdjustmentInputSchema] as const, "amount"),
    comment: text([AddPayrollAdjustmentInputSchema] as const, "comment"),
  },
  payrollReopen: {
    reason: text([ReopenPayrollMonthInputSchema] as const, "reason"),
  },
  // «Ученики → Пробные»: the person's details (manual entry and edit), the
  // person's own words (manual entry only), the staff note and the refusal.
  // A child's name and age being required together is a refine the contract
  // can't carry (refineLeadContact), so the form keeps it.
  lead: {
    name: text(LEAD, "name"),
    phone: text(LEAD, "phone"),
    email: text(LEAD, "email"),
    childName: text(LEAD, "childName"),
    childAge: int(LEAD, "childAge"),
    comment: text([CreateLeadInputSchema] as const, "comment"),
  },
  leadNote: {
    staffNote: text(LEAD, "staffNote"),
  },
  leadLost: {
    comment: text([SetLeadStatusInputSchema] as const, "lostComment"),
  },
  // Federation hub: the org console and the platform's «Создать федерацию».
  orgAnnouncement: {
    title: text(ORG_ANNOUNCEMENT, "title"),
    body: text(ORG_ANNOUNCEMENT, "body"),
  },
  orgEvent: {
    title: text(ORG_EVENT, "title"),
    description: text(ORG_EVENT, "description"),
    place: text(ORG_EVENT, "place"),
    address: text(ORG_EVENT, "address"),
    feeNote: text(ORG_EVENT, "feeNote"),
    capacity: int(ORG_EVENT, "capacity"),
  },
  organization: {
    name: text([UpdateOrganizationInputDtoSchema] as const, "name"),
    city: text([UpdateOrganizationInputDtoSchema] as const, "city"),
    description: text([UpdateOrganizationInputDtoSchema] as const, "description"),
  },
  orgInvite: {
    joinCode: text([InviteClubToOrganizationInputDtoSchema] as const, "joinCode"),
  },
  orgTemplate: {
    name: text(ORG_TEMPLATE, "name"),
    audience: text(ORG_TEMPLATE, "audience"),
  },
  templateLevel: {
    name: text(TEMPLATE_LEVEL, "name"),
    color: text(TEMPLATE_LEVEL, "color"),
    maxStripes: int(TEMPLATE_LEVEL, "maxStripes"),
    minVisits: int(TEMPLATE_LEVEL, "minVisits"),
    minWeeks: int(TEMPLATE_LEVEL, "minWeeks"),
  },
  platformOrganization: {
    name: text([CreatePlatformOrganizationInputDtoSchema] as const, "name"),
    key: text([CreatePlatformOrganizationInputDtoSchema] as const, "key"),
    city: text([CreatePlatformOrganizationInputDtoSchema] as const, "city"),
  },
  // Federation tournaments (docs/design/2026-11-27-tournaments.md §3 limits).
  // Weights are kg with one decimal: the bound is whole kg, the 0,1 step is a
  // refine the contract can't carry (WeightKgSchema), so the forms check it.
  tournament: {
    matCount: int([UpdateOrgTournamentInputSchema] as const, "matCount"),
  },
  division: {
    name: text(DIVISION, "name"),
    ageMin: int(DIVISION, "ageMin"),
    ageMax: int(DIVISION, "ageMax"),
    weightMinKg: int(DIVISION, "weightMinKg"),
    weightMaxKg: int(DIVISION, "weightMaxKg"),
    rows: items([CreateTournamentDivisionsInputSchema] as const, "rows"),
  },
  weighIn: {
    weighedKg: int([RecordTournamentWeighInInputSchema] as const, "weighedKg"),
  },
  matchResult: {
    scoreA: int([RecordTournamentMatchResultInputSchema] as const, "scoreA"),
    scoreB: int([RecordTournamentMatchResultInputSchema] as const, "scoreB"),
    note: text([RecordTournamentMatchResultInputSchema] as const, "note"),
  },
} as const satisfies Record<string, Record<string, ContractLimit>>
