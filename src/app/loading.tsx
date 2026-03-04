export default function RootLoading() {
  return (
    <div className="flex h-screen items-center justify-center bg-stone-50 dark:bg-[#101214]" role="status" aria-label="Loading dashboard">
      <div className="flex items-center gap-1.5" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:300ms]" />
      </div>
    </div>
  );
}
