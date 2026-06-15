"use client"

import { type WorkspaceMember } from "../../shared/api/members"
import {
  ACTIVITY_CHIP,
  ACTIVITY_LABEL,
  computeActivity,
} from "../../shared/lib/member-activity"

type Props = {
  member: WorkspaceMember
  videoTotal: number
}

export function MemberProgressBlock({ member, videoTotal }: Props) {
  const activity = computeActivity(member.lastWatchedAt)
  const completedPct =
    videoTotal > 0
      ? Math.min(100, Math.round((member.watchedCount / videoTotal) * 100))
      : 0
  const inProgress = member.inProgressCount

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${ACTIVITY_CHIP[activity]}`}
      >
        {ACTIVITY_LABEL[activity]}
      </span>
      <span className="font-medium text-foreground tabular-nums">
        {member.watchedCount}/{videoTotal} видео
      </span>
      <span className="text-muted-foreground">·</span>
      <span className="tabular-nums text-muted-foreground">
        {completedPct}%
      </span>
      {inProgress > 0 && (
        <>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            {inProgress} в процессе
          </span>
        </>
      )}
    </div>
  )
}
