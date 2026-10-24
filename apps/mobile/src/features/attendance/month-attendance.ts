import { getMyAttendance, type MyAttendance } from "../../shared/api/attendance"
import { monthWindow } from "../progress/progress-helpers"

// One page holds a whole month: nobody trains a hundred times in one.
export const MONTH_PAGE_SIZE = 100

// The Progress hub and the calendar share this key, so their counts agree.
export const monthAttendanceKey = (workspaceId: string, ym: string): string =>
  `attendance:${workspaceId}:cal:${ym}`

// A month of the member's attendance, padded a day each side (see
// monthWindow); callers trim it with inMonth.
export const fetchMonthAttendance = async (
  workspaceId: string,
  ym: string,
  curPage = 1,
): Promise<MyAttendance> =>
  await getMyAttendance({
    workspaceId,
    ...monthWindow(ym, new Date()),
    curPage,
    perPage: MONTH_PAGE_SIZE,
  })
