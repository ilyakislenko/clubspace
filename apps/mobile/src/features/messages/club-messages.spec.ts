import {
  asFlag,
  asIdList,
  composeError,
  formatMessageDate,
  hasDraft,
  isQuietHour,
  markReadInList,
  messageByline,
  previewSentence,
  sendButtonLabel,
  sendConfirmTitle,
  sentToast,
} from "./club-messages"

// Local wall-clock dates: the helpers format in the member's own clock.
const at = (y: number, mo: number, d: number, h = 12, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).toISOString()
const NOW = new Date(2026, 10, 26, 15, 0)

describe("read state", () => {
  const list = [
    { id: "a", sentAt: at(2026, 11, 26), readAt: null },
    { id: "b", sentAt: at(2026, 11, 25), readAt: at(2026, 11, 25, 13) },
    { id: "c", sentAt: at(2026, 11, 24), readAt: null },
  ]

  it("stamps the opened message and leaves the rest", () => {
    const next = markReadInList(list, "a", "2026-11-26T12:00:00.000Z")
    expect(next.map((m) => m.readAt)).toEqual([
      "2026-11-26T12:00:00.000Z",
      list[1].readAt,
      null,
    ])
    expect(next[2]).toBe(list[2])
  })

  it("keeps the first stamp of a message opened again", () => {
    const next = markReadInList(list, "b", "2026-11-26T12:00:00.000Z")
    expect(next[1].readAt).toBe(list[1].readAt)
  })
})

describe("dates", () => {
  it("names today and yesterday with the time, other days by date", () => {
    expect(formatMessageDate(at(2026, 11, 26, 9, 5), NOW)).toBe("сегодня, 9:05")
    expect(formatMessageDate(at(2026, 11, 25, 18, 40), NOW)).toBe("вчера, 18:40")
    expect(formatMessageDate(at(2026, 11, 12), NOW)).toBe("12 ноября")
    expect(formatMessageDate(at(2025, 12, 31), NOW)).toBe("31 декабря 2025")
  })

  it("signs a message with its author and date", () => {
    expect(
      messageByline({ authorName: "Анна Смирнова", sentAt: at(2026, 11, 12) }, NOW),
    ).toBe("от Анна Смирнова, 12 ноября")
    expect(messageByline({ authorName: "Анна", sentAt: null }, NOW)).toBe("от Анна")
  })
})

describe("route params after a web reload", () => {
  it("reads an id list from an array, one string or nothing", () => {
    expect(asIdList(["a", "b", "", 3])).toEqual(["a", "b"])
    expect(asIdList("a")).toEqual(["a"])
    expect(asIdList("a,b")).toEqual(["a", "b"])
    expect(asIdList(undefined)).toEqual([])
    expect(asIdList("")).toEqual([])
  })

  it("reads a flag from a boolean or its string", () => {
    expect(asFlag(true)).toBe(true)
    expect(asFlag("true")).toBe(true)
    expect(asFlag("false")).toBe(false)
    expect(asFlag(undefined)).toBe(false)
  })
})

describe("previewSentence", () => {
  const base = {
    recipients: 52,
    children: 3,
    withPush: 40,
    optedOut: 4,
    muted: 0,
    noDevice: 8,
    capped: 0,
    withEmail: 30,
    emailAllowance: null,
    deferredByQuietHours: false,
  }
  const plain = { urgent: false, withEmail: false }

  it("names who gets it and through which channel", () => {
    expect(previewSentence(base, plain)).toBe(
      "Получат 52 ученика (3 ребёнка — их родителям). В приложении — 40, отключили сообщения — 4, без приложения — 8.",
    )
  })

  it("says one student and one child in the singular", () => {
    expect(
      previewSentence(
        { ...base, recipients: 1, children: 1, withPush: 1, optedOut: 0, noDevice: 0 },
        plain,
      ),
    ).toBe("Получит 1 ученик (1 ребёнок — его родителям). В приложении — 1.")
  })

  it("names the club mute and the daily push cap, leaving zero parts out", () => {
    expect(
      previewSentence(
        {
          ...base,
          recipients: 6,
          children: 0,
          withPush: 3,
          optedOut: 0,
          muted: 2,
          capped: 1,
          noDevice: 0,
        },
        plain,
      ),
    ).toBe(
      "Получат 6 учеников. В приложении — 3, выключили уведомления клуба — 2, уже получили 3 рассылки сегодня — 1.",
    )
  })

  it("counts the e-mail copies only when they are asked for, and a short trial allowance", () => {
    const email = { urgent: false, withEmail: true }
    expect(previewSentence(base, email)).toMatch(/без приложения — 8, e-mail — 30\.$/)
    expect(previewSentence({ ...base, emailAllowance: 12 }, email)).toMatch(
      /e-mail — 30\. E-mail: осталось 12 писем пробного периода\.$/,
    )
    expect(previewSentence({ ...base, emailAllowance: 100 }, email)).not.toMatch(
      /пробного/,
    )
  })

  it("warns about quiet hours unless the message is urgent", () => {
    const quiet = { ...base, deferredByQuietHours: true }
    expect(previewSentence(quiet, plain)).toMatch(
      /Сейчас тихие часы: уйдёт в 09:00 по времени клуба\.$/,
    )
    expect(
      previewSentence(quiet, { urgent: true, withEmail: false }),
    ).not.toMatch(/тихие часы/)
  })

  it("says so when nobody would get it", () => {
    expect(previewSentence({ ...base, recipients: 0 }, plain)).toBe(
      "Сейчас этому адресату писать некому.",
    )
  })
})

describe("isQuietHour", () => {
  it("is night from 22:00 to 09:00 on the club clock (Tomsk, UTC+7)", () => {
    const tomsk = "Asia/Tomsk"
    expect(isQuietHour(new Date("2026-11-26T14:59:00Z"), tomsk)).toBe(false) // 21:59
    expect(isQuietHour(new Date("2026-11-26T15:00:00Z"), tomsk)).toBe(true) // 22:00
    expect(isQuietHour(new Date("2026-11-26T17:00:00Z"), tomsk)).toBe(true) // 00:00
    expect(isQuietHour(new Date("2026-11-27T01:59:00Z"), tomsk)).toBe(true) // 08:59
    expect(isQuietHour(new Date("2026-11-27T02:00:00Z"), tomsk)).toBe(false) // 09:00
  })

  it("judges a zone west of UTC by its own clock", () => {
    const ny = "America/New_York" // UTC−5 in November
    expect(isQuietHour(new Date("2026-11-27T02:59:00Z"), ny)).toBe(false) // 21:59
    expect(isQuietHour(new Date("2026-11-27T03:00:00Z"), ny)).toBe(true) // 22:00
    expect(isQuietHour(new Date("2026-11-27T14:00:00Z"), ny)).toBe(false) // 09:00
  })
})

describe("sending", () => {
  it("asks before writing to more than one student", () => {
    expect(sendConfirmTitle(1)).toBeNull()
    expect(sendConfirmTitle(0)).toBeNull()
    expect(sendConfirmTitle(2)).toBe("Отправить 2 ученикам?")
    expect(sendConfirmTitle(21)).toBe("Отправить 21 ученику?")
  })

  it("schedules a message held by quiet hours, sends an urgent one", () => {
    expect(sendButtonLabel(false, false)).toBe("Отправить")
    expect(sendButtonLabel(true, false)).toBe("Запланировать")
    expect(sendButtonLabel(true, true)).toBe("Отправить")
  })

  it("tells sent from scheduled", () => {
    expect(sentToast("SENT")).toBe("Сообщение отправлено")
    expect(sentToast("SCHEDULED")).toBe("Сообщение уйдёт в 09:00")
  })

  it("counts typed text, not blanks, as a draft to keep", () => {
    expect(hasDraft("", "")).toBe(false)
    expect(hasDraft("  ", "\n")).toBe(false)
    expect(hasDraft("Тема", "")).toBe(true)
    expect(hasDraft("", "текст")).toBe(true)
  })

  it("asks for a title and a text within the limits", () => {
    const limits = { title: 5, body: 10 }
    expect(composeError(" ", "текст", limits)).toBe("Введите заголовок")
    expect(composeError("Тема", "  ", limits)).toBe("Введите текст")
    expect(composeError("Длинная тема", "текст", limits)).toBe(
      "Заголовок — до 5 символов",
    )
    expect(composeError("Тема", "очень длинный текст", limits)).toBe(
      "Текст — до 10 символов",
    )
    expect(composeError("Тема", "текст", limits)).toBeNull()
  })
})
