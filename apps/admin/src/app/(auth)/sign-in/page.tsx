"use client";

import { Button } from "@bjj-academy/ui-kit/ui";
import { getInstanceBrand } from "@bjj-academy/ui-kit/brand";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { getAuthApi, storeAuthTokens } from "../../../shared/api/client";

// Matches the server's resend cooldown (COMPLETE_CODE_TIMEOUT, 60s).
const RESEND_COOLDOWN_SECONDS = 60;

export default function SignIn() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const router = useRouter();

  // Tick the resend cooldown down to zero.
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const handleSendCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setIsLoading(true);
    try {
      await getAuthApi().sendAuthCode({ email, language: "EN" });
      setStep("code");
      setResendIn(RESEND_COOLDOWN_SECONDS);
    } catch {
      setError("Failed to send verification code. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const response = await getAuthApi().signIn({ email, code });
      storeAuthTokens(response);
      router.replace("/workspaces");
    } catch {
      setError("Invalid verification code. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (resendIn > 0) return;
    setError(null);
    setNotice(null);
    setIsLoading(true);
    try {
      await getAuthApi().sendAuthCode({ email, language: "EN" });
      setResendIn(RESEND_COOLDOWN_SECONDS);
      setNotice("A new code is on its way — check your inbox.");
    } catch {
      setError("Failed to resend the code. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm md:max-w-3xl">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <span aria-hidden className="text-3xl">{getInstanceBrand().emoji}</span>
            <h1 className="text-2xl font-bold">{getInstanceBrand().name} — Админка</h1>
            <p className="text-balance text-sm text-muted-foreground">
              {step === "email"
                ? "Enter your email to sign in to your account"
                : "We sent a verification code to your email"}
            </p>
          </div>

          {step === "email" ? (
            <div className="grid gap-6">
              <form className="grid gap-6" onSubmit={handleSendCode}>
                <div className="grid gap-2">
                  <label htmlFor="email" className="text-sm font-medium">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    placeholder="m@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading}
                >
                  Continue with Email
                </Button>
              </form>

              {/* <div className="relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-border">
                <span className="relative z-10 bg-background px-2 text-muted-foreground">
                  Or continue with
                </span>
              </div> */}

              {/* <div className="grid grid-cols-2 gap-4">
                <Button variant="outline" className="w-full">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                  >
                    <path
                      d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                      fill="currentColor"
                    />
                  </svg>
                  Google
                </Button>
                <Button variant="outline" className="w-full">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                  >
                    <path
                      d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
                      fill="currentColor"
                    />
                  </svg>
                  GitHub
                </Button>
              </div> */}
            </div>
          ) : (
            <div className="grid gap-6">
              <div className="flex items-center justify-between rounded-lg border bg-card p-4">
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Sent to</p>
                  <p className="text-sm font-medium">{email}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep("email")}
                  disabled={isLoading}
                >
                  Change
                </Button>
              </div>

              <form className="grid gap-6" onSubmit={handleVerifyCode}>
                <div className="grid gap-2">
                  <label htmlFor="code" className="text-sm font-medium">
                    Verification Code
                  </label>
                  <input
                    id="code"
                    type="text"
                    placeholder="000000"
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 text-center text-2xl font-mono tracking-widest shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  Verify & Sign In
                </Button>
              </form>

              <div className="text-center text-sm">
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-4 hover:underline disabled:no-underline disabled:opacity-60"
                  onClick={handleResendCode}
                  disabled={isLoading || resendIn > 0}
                >
                  {resendIn > 0
                    ? `Resend the code in ${resendIn}s`
                    : "Didn't receive the code? Resend"}
                </button>
              </div>
            </div>
          )}

          {notice ? (
            <p className="rounded-md border border-emerald-600/30 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {notice}
            </p>
          ) : null}

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
