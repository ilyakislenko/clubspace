/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react"

import { PublishedAtBadge } from "./PublishedAtBadge"

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()

describe("PublishedAtBadge", () => {
  it("offers to schedule when there is no publish date", () => {
    render(<PublishedAtBadge publishedAt={null} onOpen={() => undefined} />)
    expect(screen.getByText(/Запланировать/)).toBeTruthy()
  })

  it("shows a future (scheduled) publish date", () => {
    render(
      <PublishedAtBadge publishedAt={iso(86_400_000)} onOpen={() => undefined} />,
    )
    expect(screen.getByText(/Откроется/)).toBeTruthy()
  })

  it("shows a past (live) publish date", () => {
    render(
      <PublishedAtBadge publishedAt={iso(-86_400_000)} onOpen={() => undefined} />,
    )
    expect(screen.getByText(/Открыт с/)).toBeTruthy()
  })

  it("invokes onOpen when clicked", () => {
    const onOpen = jest.fn()
    render(<PublishedAtBadge publishedAt={null} onOpen={onOpen} />)
    fireEvent.click(screen.getByText(/Запланировать/))
    expect(onOpen).toHaveBeenCalled()
  })
})
