/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

jest.mock("../../shared/api/bank-statements", () => ({
  previewBankStatement: jest.fn(),
  confirmBankStatement: jest.fn(),
}))

import {
  confirmBankStatement,
  previewBankStatement,
  type BankStatementCandidate,
  type BankStatementPreview,
  type BankStatementTransaction,
} from "../../shared/api/bank-statements"
import { ConfirmDialogHost } from "../../shared/ui/confirm-dialog"
import { StatementMatchSheet } from "./StatementMatchSheet"

const previewMock = previewBankStatement as jest.Mock
const confirmMock = confirmBankStatement as jest.Mock

const FP = (n: number) => String(n).repeat(64)

const cand = (over: Partial<BankStatementCandidate> = {}): BankStatementCandidate => ({
  subscriptionId: "s-ivan",
  userId: "u-ivan",
  memberName: "Иван Иванов",
  planName: "Безлимит",
  amount: 3000,
  currency: "RUB",
  startDate: "2026-11-01",
  soldOn: "2026-10-30",
  score: 90,
  reasons: ["AMOUNT_EXACT", "PAYER_NAME"],
  paidBy: null,
  ...over,
})

const tx = (over: Partial<BankStatementTransaction> = {}): BankStatementTransaction => ({
  fingerprint: FP(1),
  date: "2026-11-05",
  time: null,
  amount: 3000,
  receivedAmount: 3000,
  currency: "RUB",
  payer: "ИВАНОВ ИВАН ИВАНОВИЧ",
  purpose: "Абонемент",
  docNumber: "12",
  status: "MATCHED",
  suggestedSubscriptionId: "s-ivan",
  flags: [],
  candidates: [cand()],
  matchedTo: null,
  ...over,
})

const MISHA = cand({
  subscriptionId: "s-misha",
  memberName: "Михаил Петров",
  planName: "Дети",
  reasons: ["AMOUNT_EXACT", "GUARDIAN_NAME"],
  paidBy: "Елена Петрова",
})
const ANYA = cand({ subscriptionId: "s-anya", memberName: "Анна Петрова", planName: "Дети", paidBy: "Елена Петрова" })

const statement = (): BankStatementPreview => ({
  format: "ONE_C",
  skippedDebits: 1,
  directionKnown: true,
  columns: null,
  transactions: [
    tx(),
    tx({
      fingerprint: FP(2),
      payer: "ПЕТРОВА ЕЛЕНА",
      status: "AMBIGUOUS",
      suggestedSubscriptionId: null,
      flags: ["SIMILAR_CANDIDATES"],
      candidates: [MISHA, ANYA],
    }),
    tx({
      fingerprint: FP(3),
      payer: "ООО «РОМАШКА»",
      amount: 12000,
      receivedAmount: 12000,
      status: "UNMATCHED",
      suggestedSubscriptionId: null,
      candidates: [],
    }),
    tx({
      fingerprint: FP(4),
      date: "2026-11-02",
      status: "ALREADY_MATCHED",
      suggestedSubscriptionId: null,
      candidates: [],
      matchedTo: {
        subscriptionId: "s-old",
        userId: "u-old",
        memberName: "Олег Козлов",
        planName: "8 занятий",
        matchedAt: "2026-11-03T10:00:00.000Z",
      },
    }),
  ],
  counts: { matched: 1, ambiguous: 1, unmatched: 1, alreadyMatched: 1 },
})

const renderSheet = () => {
  const handlers = { onClose: jest.fn(), onConfirmed: jest.fn() }
  render(
    <>
      <StatementMatchSheet workspaceId="w1" open {...handlers} />
      <ConfirmDialogHost />
    </>,
  )
  return handlers
}

const upload = (name = "kl_to_1c.txt") => {
  const file = new File(["1CClientBankExchange"], name, { type: "text/plain" })
  fireEvent.change(screen.getByLabelText("Файл выписки"), { target: { files: [file] } })
  return file
}

const plain = (s: string | null | undefined) => s?.replace(/\s/g, " ") ?? ""

beforeEach(() => {
  previewMock.mockReset()
  confirmMock.mockReset()
})

describe("StatementMatchSheet", () => {
  it("reviews a statement: confident match chosen, ambiguous waits for a pick, the rest listed", async () => {
    previewMock.mockResolvedValue(statement())
    renderSheet()
    const file = upload()
    await screen.findByText("4 поступления: совпадают 1, выбрать 1, без пары 1, уже сверены 1")
    expect(previewMock).toHaveBeenCalledWith({ workspaceId: "w1", file, fileName: "kl_to_1c.txt", columns: null })

    const matched = within(screen.getByRole("region", { name: "Совпадают" }))
    expect((matched.getByRole("combobox") as HTMLSelectElement).value).toBe("s-ivan")
    expect(matched.getByText("Совпали: сумма, имя плательщика")).toBeTruthy()

    const ambiguous = within(screen.getByRole("region", { name: "Нужно выбрать" }))
    expect((ambiguous.getByRole("combobox") as HTMLSelectElement).value).toBe("")
    expect(ambiguous.getByText("Подходят несколько учеников — выберите нужного")).toBeTruthy()

    expect(screen.getByText("Нет неоплаченного абонемента с такой суммой или именем")).toBeTruthy()
    expect(screen.getByText("Олег Козлов · 8 занятий")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Отметить оплату · 1" })).toBeTruthy()
  })

  it("confirms the chosen matches, a picked child included, and reports the result", async () => {
    previewMock.mockResolvedValue(statement())
    confirmMock.mockResolvedValue({
      confirmed: 1,
      results: [
        { fingerprint: FP(1), subscriptionId: "s-ivan", status: "CONFIRMED", message: null },
        { fingerprint: FP(2), subscriptionId: "s-misha", status: "FAILED", message: "Оплата уже отмечена 4 нояб. 2026" },
      ],
    })
    const handlers = renderSheet()
    upload()
    const ambiguous = within(await screen.findByRole("region", { name: "Нужно выбрать" }))
    fireEvent.change(ambiguous.getByRole("combobox"), { target: { value: "s-misha" } })
    expect(ambiguous.getByText("Совпали: сумма, родитель Елена Петрова")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Отметить оплату · 2" }))
    await screen.findByText("Отмечено 1 оплата переводом")
    expect(confirmMock).toHaveBeenCalledWith({
      workspaceId: "w1",
      matches: [
        { fingerprint: FP(1), subscriptionId: "s-ivan", amount: 3000, paidOn: "2026-11-05", paidTime: null },
        { fingerprint: FP(2), subscriptionId: "s-misha", amount: 3000, paidOn: "2026-11-05", paidTime: null },
      ],
    })
    expect(plain(screen.getByText(/Оплата уже отмечена/).textContent)).toBe(
      "5 нояб. · 3 000 ₽ — Оплата уже отмечена 4 нояб. 2026",
    )
    expect(handlers.onConfirmed).toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Готово" }))
    await waitFor(() => expect(handlers.onClose).toHaveBeenCalled())
  })

  it("won't send one abonement for two transfers, and «Не отмечать» drops a match", async () => {
    const p = statement()
    p.transactions[1] = { ...p.transactions[1], candidates: [cand(), MISHA] }
    previewMock.mockResolvedValue(p)
    renderSheet()
    upload()
    const ambiguous = within(await screen.findByRole("region", { name: "Нужно выбрать" }))
    fireEvent.change(ambiguous.getByRole("combobox"), { target: { value: "s-ivan" } })
    expect(ambiguous.getByText("Этот абонемент выбран и для другого перевода")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Отметить оплату · 2" }) as HTMLButtonElement).disabled).toBe(true)

    const matched = within(screen.getByRole("region", { name: "Совпадают" }))
    fireEvent.change(matched.getByRole("combobox"), { target: { value: "" } })
    expect((screen.getByRole("button", { name: "Отметить оплату · 1" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("warns when the amount received differs from the price", async () => {
    const p = statement()
    p.transactions[0] = { ...p.transactions[0], amount: 2500, receivedAmount: 2500, flags: ["AMOUNT_DIFFERS"] }
    previewMock.mockResolvedValue(p)
    renderSheet()
    upload()
    const matched = within(await screen.findByRole("region", { name: "Совпадают" }))
    expect(plain(matched.getByText(/Пришло на/).textContent)).toBe(
      "Пришло на 500 ₽ меньше цены — оплата будет отмечена на 2 500 ₽, разница станет разовой скидкой",
    )
  })

  it("asks for the columns of an unknown export and re-reads the file with them", async () => {
    previewMock.mockResolvedValueOnce({
      ...statement(),
      format: "CSV",
      transactions: [],
      counts: { matched: 0, ambiguous: 0, unmatched: 0, alreadyMatched: 0 },
      columns: {
        complete: false,
        headers: ["Когда", "Сколько", "Кто", "Зачем"],
        sample: [["28.11.2026", "3000", "Иван И.", "абонемент"]],
        date: null,
        amount: null,
        payer: null,
        purpose: null,
      },
    })
    previewMock.mockResolvedValueOnce({ ...statement(), format: "CSV" })
    renderSheet()
    const file = upload("operations.csv")
    await screen.findByText("Укажите, в каких колонках дата, сумма и плательщик.")
    const go = screen.getByRole("button", { name: "Продолжить" }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    expect(screen.getByText("Иван И.")).toBeTruthy()

    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: "0" } })
    fireEvent.change(screen.getByLabelText("Сумма поступления"), { target: { value: "1" } })
    fireEvent.change(screen.getByLabelText("Плательщик"), { target: { value: "2" } })
    fireEvent.click(go)
    await screen.findByRole("region", { name: "Совпадают" })
    expect(previewMock).toHaveBeenLastCalledWith({
      workspaceId: "w1",
      file,
      fileName: "operations.csv",
      columns: { date: 0, amount: 1, payer: 2, purpose: null },
    })
  })

  it("says when the file doesn’t tell incoming from outgoing", async () => {
    previewMock.mockResolvedValue({ ...statement(), directionKnown: false })
    renderSheet()
    upload()
    expect(
      await screen.findByText(
        "В файле не видно, где поступления, а где списания, — ничего не выбрано заранее, проверьте каждую строку.",
      ),
    ).toBeTruthy()
  })

  it("keeps the note away when the direction is known", async () => {
    previewMock.mockResolvedValue(statement())
    renderSheet()
    upload()
    await screen.findByRole("region", { name: "Совпадают" })
    expect(screen.queryByText(/не видно, где поступления/)).toBeNull()
  })

  it("shows the server’s message for a file it can’t read", async () => {
    previewMock.mockRejectedValue(new Error("Не удалось распознать выписку"))
    renderSheet()
    upload("statement.pdf")
    await waitFor(() => expect(screen.getByText(/Не удалось/)).toBeTruthy())
    expect(screen.getByLabelText("Файл выписки")).toBeTruthy()
  })
})
