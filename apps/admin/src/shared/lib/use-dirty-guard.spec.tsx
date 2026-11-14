/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react"

import { ConfirmDialogHost } from "../ui/confirm-dialog"

import {
  clickLeavesPage,
  confirmLeave,
  hasUnsavedChanges,
  sameData,
  useDirtyGuard,
} from "./use-dirty-guard"

const click = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
}
const anchor = (href: string, over: Partial<{ target: string; download: boolean }> = {}) => ({
  href,
  target: "",
  download: false,
  ...over,
})
const here = new URL("https://admin.test/workspace/w1/settings?tab=main")

describe("sameData", () => {
  it("treats a draft equal to the saved values as clean, whatever the key order", () => {
    expect(
      sameData(
        { rules: "x", contacts: [{ label: "Админ", phone: "+7" }] },
        { contacts: [{ phone: "+7", label: "Админ" }], rules: "x" },
      ),
    ).toBe(true)
  })

  it("sees an edited, added, removed or reordered item as a change", () => {
    const saved = { items: [{ v: 1 }, { v: 2 }] }
    expect(sameData({ items: [{ v: 1 }, { v: 3 }] }, saved)).toBe(false)
    expect(sameData({ items: [{ v: 1 }] }, saved)).toBe(false)
    expect(sameData({ items: [{ v: 2 }, { v: 1 }] }, saved)).toBe(false)
    expect(sameData({ items: [{ v: 1 }, { v: 2 }], extra: null }, saved)).toBe(false)
  })

  it("tells null, empty string and missing apart", () => {
    expect(sameData({ a: null }, { a: "" })).toBe(false)
    expect(sameData({ a: undefined }, {})).toBe(false)
    expect(sameData([], {})).toBe(false)
  })
})

describe("clickLeavesPage", () => {
  it("is true for a plain click to another page of the app", () => {
    expect(clickLeavesPage(click, anchor("/workspace/w1/users"), here)).toBe(true)
  })

  it("is true when only the query changes", () => {
    expect(
      clickLeavesPage(click, anchor("/workspace/w1/settings?tab=other"), here),
    ).toBe(true)
  })

  it("is false for a #hash jump on the same page", () => {
    expect(
      clickLeavesPage(click, anchor("/workspace/w1/settings?tab=main#top"), here),
    ).toBe(false)
  })

  it("is false when the link opens elsewhere", () => {
    const to = "/workspace/w1/users"
    expect(clickLeavesPage({ ...click, metaKey: true }, anchor(to), here)).toBe(false)
    expect(clickLeavesPage({ ...click, ctrlKey: true }, anchor(to), here)).toBe(false)
    expect(clickLeavesPage({ ...click, shiftKey: true }, anchor(to), here)).toBe(false)
    expect(clickLeavesPage({ ...click, button: 1 }, anchor(to), here)).toBe(false)
    expect(clickLeavesPage(click, anchor(to, { target: "_blank" }), here)).toBe(false)
    expect(clickLeavesPage(click, anchor(to, { download: true }), here)).toBe(false)
  })

  it("leaves another origin to the browser's own beforeunload prompt", () => {
    expect(clickLeavesPage(click, anchor("https://example.com/"), here)).toBe(false)
  })

  it("is false when someone already handled the click", () => {
    expect(
      clickLeavesPage({ ...click, defaultPrevented: true }, anchor("/x"), here),
    ).toBe(false)
  })
})

function Form({ dirty }: { dirty: boolean }) {
  useDirtyGuard(dirty)
  return <a href="/workspace/w1/users">Ученики</a>
}

const answer = async (label: "Уйти" | "Остаться") => {
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByText("Уйти без сохранения?")).toBeTruthy()
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: label }))
  })
}

describe("useDirtyGuard", () => {
  // Link clicks that got past the guard; prevented here so jsdom does not
  // navigate. Clicks on the dialog's buttons are not counted.
  let passed: MouseEvent[]
  const onBubble = (event: MouseEvent) => {
    if (!(event.target instanceof HTMLAnchorElement)) return
    passed.push(event)
    event.preventDefault()
  }

  beforeEach(() => {
    passed = []
    document.addEventListener("click", onBubble)
  })
  afterEach(() => document.removeEventListener("click", onBubble))

  const clickLink = () => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
    act(() => {
      screen.getByText("Ученики").dispatchEvent(event)
    })
    return event
  }

  it("holds a link click on a dirty form and stays on «Остаться»", async () => {
    const { unmount } = render(
      <>
        <Form dirty />
        <ConfirmDialogHost />
      </>,
    )

    const event = clickLink()
    expect(event.defaultPrevented).toBe(true)

    await answer("Остаться")
    expect(passed).toHaveLength(0)
    unmount()
  })

  it("replays the click on the same link after «Уйти»", async () => {
    const { unmount } = render(
      <>
        <Form dirty />
        <ConfirmDialogHost />
      </>,
    )

    clickLink()
    await answer("Уйти")
    expect(passed).toHaveLength(1)
    expect(passed[0].target).toBe(screen.getByText("Ученики"))
    unmount()
  })

  it("does not ask while the form matches what was saved", () => {
    const { unmount } = render(
      <>
        <Form dirty={false} />
        <ConfirmDialogHost />
      </>,
    )

    clickLink()
    expect(passed).toHaveLength(1)
    expect(screen.queryByRole("dialog")).toBeNull()
    unmount()
  })

  it("stops asking once saved and once unmounted", () => {
    const { rerender, unmount } = render(<Form dirty />)
    expect(hasUnsavedChanges()).toBe(true)

    rerender(<Form dirty={false} />)
    expect(hasUnsavedChanges()).toBe(false)

    rerender(<Form dirty />)
    unmount()
    expect(hasUnsavedChanges()).toBe(false)
  })

  it("asks the browser to confirm closing the tab while dirty", () => {
    const { rerender, unmount } = render(<Form dirty />)
    const dirtyUnload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(dirtyUnload)
    expect(dirtyUnload.defaultPrevented).toBe(true)

    rerender(<Form dirty={false} />)
    const cleanUnload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(cleanUnload)
    expect(cleanUnload.defaultPrevented).toBe(false)
    unmount()
  })

  it("guards programmatic navigation through confirmLeave", async () => {
    const { rerender, unmount } = render(
      <>
        <Form dirty />
        <ConfirmDialogHost />
      </>,
    )
    let left: Promise<boolean> = Promise.resolve(true)
    act(() => {
      left = confirmLeave()
    })
    await answer("Остаться")
    await expect(left).resolves.toBe(false)

    rerender(
      <>
        <Form dirty={false} />
        <ConfirmDialogHost />
      </>,
    )
    await expect(confirmLeave()).resolves.toBe(true)
    expect(screen.queryByRole("dialog")).toBeNull()
    unmount()
  })

  it("prompts once even with two dirty forms on the page", async () => {
    const { unmount } = render(
      <>
        <Form dirty />
        <FormWithoutLink />
        <ConfirmDialogHost />
      </>,
    )

    fireEvent.click(screen.getByText("Ученики"))

    expect(await screen.findAllByRole("dialog")).toHaveLength(1)
    await answer("Остаться")
    unmount()
  })
})

function FormWithoutLink() {
  useDirtyGuard(true)
  return null
}
