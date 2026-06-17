/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react"

import { type WorkspaceMember } from "../../shared/api/members"
import { MemberProgressBlock } from "./MemberProgressBlock"

const member = (over: Partial<WorkspaceMember> = {}): WorkspaceMember =>
  ({
    watchedCount: 3,
    inProgressCount: 0,
    lastWatchedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    ...over,
  }) as WorkspaceMember

describe("MemberProgressBlock", () => {
  it("renders watched/total and the completed percentage", () => {
    render(<MemberProgressBlock member={member()} videoTotal={10} />)
    expect(screen.getByText("3/10 видео")).toBeTruthy()
    expect(screen.getByText("30%")).toBeTruthy()
  })

  it("clamps the percentage and shows the recent-activity label", () => {
    render(<MemberProgressBlock member={member()} videoTotal={10} />)
    // lastWatched 2 days ago -> active
    expect(screen.getByText("Активен")).toBeTruthy()
  })

  it("shows the in-progress count only when > 0", () => {
    const { rerender } = render(
      <MemberProgressBlock member={member({ inProgressCount: 2 })} videoTotal={10} />,
    )
    expect(screen.getByText("2 в процессе")).toBeTruthy()
    rerender(
      <MemberProgressBlock member={member({ inProgressCount: 0 })} videoTotal={10} />,
    )
    expect(screen.queryByText(/в процессе/)).toBeNull()
  })

  it("labels a member who never watched anything", () => {
    render(
      <MemberProgressBlock
        member={member({ lastWatchedAt: null, watchedCount: 0 })}
        videoTotal={10}
      />,
    )
    expect(screen.getByText("Не начинал")).toBeTruthy()
  })
})
