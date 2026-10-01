"use client";

import { useState } from "react";
import { signIn, signOut } from "next-auth/react";

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function SignInButton({ label = "Masuk dengan Google" }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  return (
    <button
      className="inline-flex h-[46px] w-full cursor-pointer items-center justify-center gap-3 rounded-full border border-[#747775] bg-white px-4 text-[14.5px] font-medium text-[#1f1f1f] transition duration-200 ease-out-soft hover:bg-[#f8f9fa] hover:shadow-[0_4px_14px_-4px_rgba(0,0,0,0.25)] active:scale-[0.98] disabled:cursor-progress disabled:opacity-75 dark:border-[#8e918f] dark:bg-[#131314] dark:text-[#e3e3e3] dark:hover:bg-[#1f1f20]"
      disabled={loading}
      onClick={() => {
        setLoading(true);
        signIn("google", { callbackUrl: "/classroom" });
      }}
    >
      {loading ? <span className="spinner text-[#1a73e8]" aria-hidden="true" /> : <GoogleLogo />}
      <span>{loading ? "Mengalihkan ke Google…" : label}</span>
    </button>
  );
}

export function SignOutButton() {
  return (
    <button className="btn" onClick={() => signOut({ callbackUrl: "/login" })}>
      Keluar
    </button>
  );
}
