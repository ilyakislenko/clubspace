import {
  clubWallClock,
  clubWallClockToIso,
  countersLine,
  emailAllowanceText,
  flagsText,
  isQuietHour,
  previewSentence,
  PUSH_SKIP_TEXT,
  readLine,
  readState,
  segmentLabel,
  segmentsFor,
  statusLabel,
  toStudents,
  whenLabel,
} from "./message-view"

const TOMSK = "Asia/Tomsk" // UTC+7
const NY = "America/New_York"

const LEAD = { isSportLead: true, isDirectionManager: false }
const MANAGER = { isSportLead: false, isDirectionManager: true }
const COACH = { isSportLead: false, isDirectionManager: false }

describe("segments", () => {
  it("offers a plain coach own students, groups, the 30-day and call-list segments", () => {
    expect(segmentsFor(COACH, { groups: true, directions: true })).toEqual([
      "ALL",
      "GROUPS",
      "INACTIVE",
      "CALL_LIST",
    ])
    expect(segmentLabel("ALL", COACH)).toBe("Все мои ученики")
  })

  it("adds the direction for its manager, renewals and debts for sport leads", () => {
    expect(segmentsFor(MANAGER, { groups: true, directions: true })).toEqual([
      "ALL",
      "GROUPS",
      "DIRECTION",
      "INACTIVE",
      "CALL_LIST",
    ])
    expect(segmentsFor(LEAD, { groups: true, directions: true })).toEqual([
      "ALL",
      "GROUPS",
      "DIRECTION",
      "RENEW",
      "UNPAID",
      "INACTIVE",
      "CALL_LIST",
    ])
    expect(segmentLabel("ALL", LEAD)).toBe("Все ученики")
  })

  it("leaves out groups and directions the club doesn't have", () => {
    expect(segmentsFor(LEAD, { groups: false, directions: false })).toEqual([
      "ALL",
      "RENEW",
      "UNPAID",
      "INACTIVE",
      "CALL_LIST",
    ])
  })

  it("puts the count in the dative with the right plural", () => {
    expect(toStudents(1)).toBe("1 ученику")
    expect(toStudents(3)).toBe("3 ученикам")
    expect(toStudents(52)).toBe("52 ученикам")
  })
})

describe("club time", () => {
  it("reads the club's wall clock and converts it back", () => {
    expect(clubWallClock(new Date("2026-11-26T15:30:00Z"), TOMSK)).toBe("2026-11-26T22:30")
    expect(clubWallClockToIso("2026-11-27T09:00", TOMSK)).toBe("2026-11-27T02:00:00.000Z")
    // West of UTC, on either side of the US DST end (2026-11-01).
    expect(clubWallClockToIso("2026-10-31T09:00", NY)).toBe("2026-10-31T13:00:00.000Z")
    expect(clubWallClockToIso("2026-11-02T09:00", NY)).toBe("2026-11-02T14:00:00.000Z")
  })

  it("knows the quiet hours on the club clock", () => {
    // 21:59 / 22:00 / 08:59 / 09:00 Tomsk.
    expect(isQuietHour(new Date("2026-11-26T14:59:00Z"), TOMSK)).toBe(false)
    expect(isQuietHour(new Date("2026-11-26T15:00:00Z"), TOMSK)).toBe(true)
    expect(isQuietHour(new Date("2026-11-27T01:59:00Z"), TOMSK)).toBe(true)
    expect(isQuietHour(new Date("2026-11-27T02:00:00Z"), TOMSK)).toBe(false)
  })

  it("says today, tomorrow or the date", () => {
    const now = new Date("2026-11-26T16:00:00Z") // 23:00 Tomsk
    expect(whenLabel("2026-11-27T02:00:00Z", TOMSK, now)).toBe("завтра в 09:00")
    expect(whenLabel("2026-11-26T16:30:00Z", TOMSK, now)).toBe("сегодня в 23:30")
    expect(whenLabel("2026-11-30T02:00:00Z", TOMSK, now)).toBe("30 ноября в 09:00")
  })
})

describe("the list row", () => {
  const now = new Date("2026-11-26T05:00:00Z")
  const sent = {
    status: "SENT" as const,
    sendAt: "2026-11-12T11:40:00Z",
    sentAt: "2026-11-12T11:40:00Z",
    createdAt: "2026-11-12T11:40:00Z",
    recipientCount: 52,
    readCount: 34,
    isService: false,
    urgent: false,
    withEmail: false,
  }

  it("shows when it went and how many opened it", () => {
    expect(statusLabel(sent, TOMSK, now)).toBe("12 нояб. в 18:40")
    expect(readLine(sent)).toBe("Открыли 34 из 52")
  })

  it("shows when a scheduled one will go, and no read line before it went", () => {
    const scheduled = { ...sent, status: "SCHEDULED" as const, sentAt: null, sendAt: "2026-11-27T02:00:00Z" }
    expect(statusLabel(scheduled, TOMSK, now)).toBe("Отправится завтра в 09:00")
    expect(readLine(scheduled)).toBeNull()
    expect(statusLabel({ ...scheduled, status: "CANCELLED" }, TOMSK, now)).toBe("Отменено")
  })

  it("names the flags in one tooltip, nothing for a plain message", () => {
    expect(flagsText(sent)).toBeNull()
    expect(flagsText({ isService: true, urgent: true, withEmail: true })).toBe(
      "Служебное, срочное, с копией на e-mail",
    )
  })

  it("lists the counters, e-mail only when it was sent by e-mail", () => {
    expect(countersLine({ ...sent, pushCount: 40, emailCount: 0 })).toBe(
      "Получили 52 · push отправлен 40 · открыли 34",
    )
    expect(countersLine({ ...sent, withEmail: true, pushCount: 40, emailCount: 12 })).toBe(
      "Получили 52 · push отправлен 40 · на e-mail 12 · открыли 34",
    )
  })
})

describe("recipients", () => {
  it("says who opened it and why there was no push", () => {
    expect(readState("2026-11-12T11:40:00Z", TOMSK)).toBe("Открыл(а) 12 нояб.")
    expect(readState(null, TOMSK)).toBe("Не открыл(а)")
    expect(PUSH_SKIP_TEXT.opted_out).toBe("без push: отключил(а) сообщения")
  })
})

describe("the compose preview", () => {
  const preview = {
    recipients: 52,
    children: 3,
    withPush: 40,
    optedOut: 4,
    muted: 0,
    noDevice: 8,
    capped: 0,
    withEmail: 0,
    emailAllowance: null,
    sendAt: "2026-11-27T02:00:00Z",
    deferredByQuietHours: false,
    timezone: TOMSK,
  }
  const now = new Date("2026-11-26T16:00:00Z")

  it("reads the design's sentence", () => {
    expect(previewSentence(preview, { scheduled: false, now })).toBe(
      "Получат 52 ученика (3 ребёнка — их родителям). Push — 40, отключили сообщения — 4, без приложения — 8.",
    )
  })

  it("names the quiet hours and a scheduled time", () => {
    expect(previewSentence({ ...preview, deferredByQuietHours: true }, { scheduled: false, now })).toContain(
      "Сейчас тихие часы: уйдёт завтра в 09:00.",
    )
    expect(previewSentence(preview, { scheduled: true, now })).toContain("Уйдёт завтра в 09:00.")
  })

  it("speaks of one recipient and of an empty segment", () => {
    expect(
      previewSentence({ ...preview, recipients: 1, children: 0, withPush: 1, optedOut: 0, noDevice: 0 }, { scheduled: false, now }),
    ).toBe("Получит 1 ученик. Push — 1.")
    expect(previewSentence({ ...preview, recipients: 0 }, { scheduled: false, now })).toBe(
      "Сейчас в этом списке нет учеников.",
    )
  })

  it("warns only when the trial e-mails run short", () => {
    expect(emailAllowanceText({ withEmail: 20, emailAllowance: 12 })).toBe(
      "E-mail: осталось 12 писем пробного периода",
    )
    expect(emailAllowanceText({ withEmail: 10, emailAllowance: 12 })).toBeNull()
    expect(emailAllowanceText({ withEmail: 10, emailAllowance: null })).toBeNull()
  })
})
