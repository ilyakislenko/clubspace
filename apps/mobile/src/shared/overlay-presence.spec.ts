import { overlayStore } from "./overlay-presence"

describe("overlayStore", () => {
  it("stays open until every overlay is closed, and notifies on each change", () => {
    const listener = jest.fn()
    const unsubscribe = overlayStore.subscribe(listener)
    expect(overlayStore.isOpen()).toBe(false)

    const closeSheet = overlayStore.open()
    const closeMenu = overlayStore.open()
    expect(overlayStore.isOpen()).toBe(true)

    closeSheet()
    expect(overlayStore.isOpen()).toBe(true)
    closeMenu()
    expect(overlayStore.isOpen()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(4)

    unsubscribe()
  })

  it("ignores a second close of the same overlay", () => {
    const closeA = overlayStore.open()
    const closeB = overlayStore.open()
    closeA()
    closeA()
    expect(overlayStore.isOpen()).toBe(true)
    closeB()
    expect(overlayStore.isOpen()).toBe(false)
  })
})
