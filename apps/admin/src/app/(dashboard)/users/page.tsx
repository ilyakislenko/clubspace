import { redirect } from "next/navigation"

export default function GlobalUsersRedirect() {
  redirect("/workspaces")
}
