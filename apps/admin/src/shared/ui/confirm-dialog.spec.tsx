/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

import { confirmDialog, ConfirmDialogHost } from "./confirm-dialog"

const ask = (title = "Удалить зал «Север»?") => {
  let answer: Promise<boolean> = Promise.resolve(false)
  act(() => {
    answer = confirmDialog({
      title,
      description: "Группы этого зала останутся без зала.",
      destructive: true,
    })
  })
  return answer
}

describe("confirmDialog", () => {
  it("resolves true on the confirm button and shows the consequences", async () => {
    render(<ConfirmDialogHost />)
    const answer = ask()
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Удалить зал «Север»?")).toBeTruthy()
    expect(within(dialog).getByText("Группы этого зала останутся без зала.")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Удалить" }))
    await expect(answer).resolves.toBe(true)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("resolves false on «Отмена» and on Esc", async () => {
    render(<ConfirmDialogHost />)
    const first = ask()
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Отмена" }))
    await expect(first).resolves.toBe(false)

    const second = ask()
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" })
    await expect(second).resolves.toBe(false)
  })

  it("confirms with Enter and focuses the confirm button on open", async () => {
    render(<ConfirmDialogHost />)
    const answer = ask()
    const dialog = await screen.findByRole("dialog")
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Удалить" })),
    )
    fireEvent.keyDown(dialog, { key: "Enter" })
    await expect(answer).resolves.toBe(true)
  })

  it("asks queued questions one after another", async () => {
    render(<ConfirmDialogHost />)
    const first = ask("Первый?")
    const second = ask("Второй?")
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Удалить" }))
    await expect(first).resolves.toBe(true)
    const dialog = await screen.findByText("Второй?")
    fireEvent.click(
      within(dialog.closest("[role=dialog]") as HTMLElement).getByRole("button", { name: "Отмена" }),
    )
    await expect(second).resolves.toBe(false)
  })

  it("labels a non-destructive confirmation «Подтвердить»", async () => {
    render(<ConfirmDialogHost />)
    let answer: Promise<boolean> = Promise.resolve(false)
    act(() => {
      answer = confirmDialog({ title: "Отправить приглашение?" })
    })
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Подтвердить" }),
    )
    await expect(answer).resolves.toBe(true)
  })

  it("refuses to ask without a mounted host and declines pending questions on unmount", async () => {
    await expect(confirmDialog({ title: "Удалить?" })).rejects.toThrow("not mounted")
    const { unmount } = render(<ConfirmDialogHost />)
    const answer = ask()
    await screen.findByRole("dialog")
    unmount()
    await expect(answer).resolves.toBe(false)
  })
})
