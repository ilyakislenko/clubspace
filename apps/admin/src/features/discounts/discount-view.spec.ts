import {
  DISCOUNT_STATUS_LABEL,
  discountChoices,
  discountDatesText,
  discountHowText,
  discountScopeText,
  discountSizeText,
  discountUsageText,
  normalizePromoCode,
  oneOffLine,
  preselectedChoice,
  staffDiscountLine,
  type SaleOptionLike,
} from "./discount-view"

// Intl puts a no-break space into numbers; compare with plain spaces.
const plain = (s: string | null) => s?.replace(/\s/g, " ") ?? null

describe("a discount's row", () => {
  it("shows the size as a percent or a sum", () => {
    expect(discountSizeText({ kind: "PERCENT", value: 10, currency: null })).toBe("−10%")
    expect(plain(discountSizeText({ kind: "FIXED", value: 500, currency: "RUB" }))).toBe("−500 ₽")
    expect(plain(discountSizeText({ kind: "FIXED", value: 1500, currency: "USD" }))).toBe(
      "−1 500 USD",
    )
  })

  it("says how it applies", () => {
    expect(discountHowText({ code: "ВЕСНА", isFamily: false })).toBe("Промокод ВЕСНА")
    expect(discountHowText({ code: null, isFamily: true })).toBe("Сама, для семьи")
    expect(discountHowText({ code: null, isFamily: false })).toBe("Выбирает сотрудник")
  })

  it("names its scope with plurals", () => {
    expect(discountScopeText({ allPlans: true, plans: [], events: false })).toBe("Все тарифы")
    expect(discountScopeText({ allPlans: true, plans: [], events: true })).toBe(
      "Все тарифы · события",
    )
    expect(discountScopeText({ allPlans: false, plans: [1], events: false })).toBe("1 тариф")
    expect(discountScopeText({ allPlans: false, plans: [1, 2, 3], events: true })).toBe(
      "3 тарифа · события",
    )
    expect(discountScopeText({ allPlans: false, plans: [1, 2, 3, 4, 5], events: false })).toBe(
      "5 тарифов",
    )
    expect(discountScopeText({ allPlans: false, plans: [], events: true })).toBe("Платные события")
  })

  it("shows dates only when set, the year only when it isn't this one", () => {
    const today = "2027-02-10"
    expect(discountDatesText({ startsOn: null, endsOn: null }, today)).toBeNull()
    expect(discountDatesText({ startsOn: null, endsOn: "2027-03-31" }, today)).toBe("до 31 марта")
    expect(discountDatesText({ startsOn: "2027-03-01", endsOn: null }, today)).toBe("с 1 марта")
    expect(discountDatesText({ startsOn: "2027-03-01", endsOn: "2028-01-15" }, today)).toBe(
      "с 1 марта до 15 января 2028",
    )
  })

  it("counts uses against the limit and the money given", () => {
    expect(discountUsageText({ uses: 0, maxUses: null, given: [] })).toBe("ещё не использовали")
    expect(discountUsageText({ uses: 0, maxUses: 50, given: [] })).toBe(
      "ещё не использовали · можно 50 раз",
    )
    expect(
      plain(discountUsageText({ uses: 14, maxUses: 50, given: [{ currency: "RUB", amount: 8400 }] })),
    ).toBe("использована 14 раз из 50 · скидок на 8 400 ₽")
    expect(discountUsageText({ uses: 2, maxUses: null, given: [] })).toBe("использована 2 раза")
    expect(discountUsageText({ uses: 1, maxUses: null, given: [{ currency: "RUB", amount: 0 }] })).toBe(
      "использована 1 раз",
    )
    expect(
      plain(
        discountUsageText({
          uses: 3,
          maxUses: null,
          given: [
            { currency: "RUB", amount: 1000 },
            { currency: "USD", amount: 20 },
          ],
        }),
      ),
    ).toBe("использована 3 раза · скидок на 1 000 ₽ + 20 USD")
  })

  it("shows a status word only when the discount isn't working", () => {
    expect(DISCOUNT_STATUS_LABEL.active).toBeNull()
    expect(DISCOUNT_STATUS_LABEL.scheduled).toBe("Ещё не началась")
    expect(DISCOUNT_STATUS_LABEL.expired).toBe("Закончилась")
    expect(DISCOUNT_STATUS_LABEL.exhausted).toBe("Лимит исчерпан")
    expect(DISCOUNT_STATUS_LABEL.archived).toBe("В архиве")
  })
})

describe("promo codes", () => {
  it("normalises like the server and refuses junk", () => {
    expect(normalizePromoCode("  весна-2027 ")).toBe("ВЕСНА-2027")
    expect(normalizePromoCode("ёлка")).toBe("ЕЛКА")
    expect(normalizePromoCode("spring")).toBe("SPRING")
    expect(normalizePromoCode("ab")).toBeNull()
    expect(normalizePromoCode("с пробелом")).toBeNull()
    expect(normalizePromoCode("A".repeat(33))).toBeNull()
    expect(normalizePromoCode("50%")).toBeNull()
  })
})

describe("«Кто давал скидки»", () => {
  const staff = (oneOff: [number, number], named: [number, number]) => ({
    name: "Петров",
    currency: "RUB",
    oneOff: { count: oneOff[0], amount: oneOff[1] },
    named: { count: named[0], amount: named[1] },
  })

  it("shows the non-zero parts, the unit once", () => {
    expect(plain(staffDiscountLine(staff([5, 3400], [3, 1200])))).toBe(
      "Петров — разовые 3 400 ₽ (5 оплат) · из списка 1 200 ₽ (3)",
    )
    expect(plain(staffDiscountLine(staff([1, 500], [0, 0])))).toBe("Петров — разовые 500 ₽ (1 оплата)")
    expect(plain(staffDiscountLine(staff([0, 0], [2, 800])))).toBe(
      "Петров — из списка 800 ₽ (2 оплаты)",
    )
  })
})

describe("the «Скидка» select", () => {
  const PLAN = "11111111-2222-4333-8444-555555555555"
  const OTHER = "22222222-2222-4333-8444-555555555555"
  const EVENT = "33333333-2222-4333-8444-555555555555"
  const options: SaleOptionLike[] = [
    {
      discountId: "fam",
      name: "Семейная",
      kind: "PERCENT",
      value: 10,
      isFamily: true,
      items: [{ planId: PLAN, eventId: null, listPrice: 4000, amount: 3600, currency: "RUB" }],
    },
    {
      discountId: "spring",
      name: "ВЕСНА",
      kind: "FIXED",
      value: 500,
      isFamily: false,
      items: [
        { planId: PLAN, eventId: null, listPrice: 4000, amount: 3500, currency: "RUB" },
        { planId: null, eventId: EVENT, listPrice: 2000, amount: 1500, currency: "RUB" },
      ],
    },
  ]

  it("offers the options with an item for the tariff, priced by the server", () => {
    const choices = discountChoices(options, { planId: PLAN })
    expect(choices.map((c) => plain(c.label))).toEqual([
      "Семейная −10% — 3 600 ₽",
      "ВЕСНА −500 ₽ — 3 500 ₽",
    ])
    expect(discountChoices(options, { planId: OTHER })).toEqual([])
    expect(discountChoices(options, { eventId: EVENT }).map((c) => c.amount)).toEqual([1500])
  })

  it("drops the amount when the sale's list price differs from today's", () => {
    const [family] = discountChoices(options, { planId: PLAN }, 5000)
    expect(family.amount).toBeNull()
    expect(family.label).toBe("Семейная −10%")
    expect(discountChoices(options, { planId: PLAN }, 4000)[0].amount).toBe(3600)
  })

  it("preselects the family option", () => {
    expect(preselectedChoice(discountChoices(options, { planId: PLAN }))).toBe("fam")
    expect(preselectedChoice(discountChoices(options, { eventId: EVENT }))).toBe("")
  })

  it("notes a typed amount below the priced one", () => {
    expect(plain(oneOffLine(4000, 3000, "RUB"))).toBe(
      "Разовая скидка −1 000 ₽ к цене по тарифу — будет видна в «Платежах»",
    )
    expect(oneOffLine(4000, 4000, "RUB")).toBeNull()
    expect(oneOffLine(4000, 4500, "RUB")).toBeNull()
    expect(oneOffLine(4000, null, "RUB")).toBeNull()
  })
})
