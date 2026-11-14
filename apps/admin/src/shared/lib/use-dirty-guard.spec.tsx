/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react"

import {
  clickLeavesPage,
  confirmLeave,
  hasUnsavedChanges,
  LEAVE_PROMPT,
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

describe("useDirtyGuard", () => {
  let confirmSpy: jest.SpyInstance

  beforeEach(() => {
    confirmSpy = jest.spyOn(window, "confirm")
  })
  afterEach(() => confirmSpy.mockRestore())

  const clickLink = () => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
    screen.getByText("Ученики").dispatchEvent(event)
    return event
  }

  it("asks before a link click leaves a dirty form and stays on «no»", () => {
    confirmSpy.mockReturnValue(false)
    const bubbled = jest.fn()
    document.addEventListener("click", bubbled)
    const { unmount } = render(<Form dirty />)

    const event = clickLink()

    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_PROMPT)
    expect(event.defaultPrevented).toBe(true)
    expect(bubbled).not.toHaveBeenCalled()
    document.removeEventListener("click", bubbled)
    unmount()
  })

  it("lets the navigation through on «yes»", () => {
    confirmSpy.mockReturnValue(true)
    const { unmount } = render(<Form dirty />)

    expect(clickLink().defaultPrevented).toBe(false)
    unmount()
  })

  it("does not ask while the form matches what was saved", () => {
    const { unmount } = render(<Form dirty={false} />)

    expect(clickLink().defaultPrevented).toBe(false)
    expect(confirmSpy).not.toHaveBeenCalled()
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

  it("guards programmatic navigation through confirmLeave", () => {
    const { rerender, unmount } = render(<Form dirty />)
    confirmSpy.mockReturnValueOnce(false)
    expect(confirmLeave()).toBe(false)

    rerender(<Form dirty={false} />)
    expect(confirmLeave()).toBe(true)
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    unmount()
  })

  it("prompts once even with two dirty forms on the page", () => {
    confirmSpy.mockReturnValue(false)
    const { unmount } = render(
      <>
        <Form dirty />
        <FormWithoutLink />
      </>,
    )

    fireEvent.click(screen.getByText("Ученики"))

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    unmount()
  })
})

function FormWithoutLink() {
  useDirtyGuard(true)
  return null
}
