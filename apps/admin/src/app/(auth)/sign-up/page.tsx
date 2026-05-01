import { redirect } from "next/navigation"

export default function SignUpRedirect() {
  redirect("/sign-in")
}
