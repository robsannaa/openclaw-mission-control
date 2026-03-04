"use client";

import { useEffect } from "react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[RootError]", error);
  }, [error]);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-stone-50 dark:bg-[#101214]">
      <h2 className="text-lg font-semibold text-stone-900 dark:text-[#f5f7fa]">
        Dashboard failed to load
      </h2>
      <p className="max-w-md text-center text-sm text-stone-500 dark:text-[#a8b0ba]">
        {error.message || "An unexpected error occurred. Please try again."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-800 dark:bg-[#2a2f36] dark:hover:bg-[#353b44]"
      >
        Retry
      </button>
    </div>
  );
}
