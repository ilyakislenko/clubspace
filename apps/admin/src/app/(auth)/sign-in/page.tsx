"use client";

import Link from "next/link";
import { useState } from "react";

export default function SignIn() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8 space-y-8">
          {/* Header */}
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold text-gray-900">Welcome back</h1>
            <p className="text-gray-600">
              {step === "email"
                ? "Enter your email to sign in to your account"
                : "We sent a verification code to your email"}
            </p>
          </div>

          {step === "email" ? (
            <div className="space-y-6">
              {/* Email Input */}
              <div className="space-y-2">
                <label htmlFor="email" className="block text-sm font-medium text-gray-900">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                  required
                />
              </div>

              {/* Continue Button */}
              <button
                onClick={() => setStep("code")}
                className="w-full bg-violet-600 hover:bg-violet-700 text-white font-medium py-3 rounded-lg transition duration-200"
              >
                Continue with Email
              </button>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-white text-gray-500">Or continue with</span>
                </div>
              </div>

              {/* Social Buttons */}
              <div className="grid grid-cols-2 gap-4">
                <button className="flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                    />
                  </svg>
                  <span className="font-medium">Google</span>
                </button>
                <button className="flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
                    />
                  </svg>
                  <span className="font-medium">GitHub</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Email Display */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-xs text-gray-500">Sent to</p>
                  <p className="text-sm font-medium text-gray-900">{email}</p>
                </div>
                <button
                  onClick={() => setStep("email")}
                  className="text-sm text-violet-600 hover:text-violet-700 font-medium"
                >
                  Change
                </button>
              </div>

              {/* Code Input */}
              <div className="space-y-2">
                <label htmlFor="code" className="block text-sm font-medium text-gray-900">
                  Verification Code
                </label>
                <input
                  id="code"
                  type="text"
                  placeholder="000000"
                  maxLength={6}
                  className="w-full px-4 py-4 text-center text-2xl font-mono tracking-widest rounded-lg border border-gray-300 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition"
                  required
                />
              </div>

              {/* Verify Button */}
              <button className="w-full bg-violet-600 hover:bg-violet-700 text-white font-medium py-3 rounded-lg transition duration-200">
                Verify & Sign In
              </button>

              {/* Resend */}
              <div className="text-center">
                <button className="text-sm text-gray-600 hover:text-gray-900 hover:underline">
                  Didn't receive the code? Resend
                </button>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="text-center text-sm text-gray-600">
            Don't have an account?{" "}
            <Link href="/signup" className="text-violet-600 hover:text-violet-700 font-medium hover:underline">
              Sign up
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
