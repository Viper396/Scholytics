"use client";

import Link from "next/link";

type NavProps = {
  selectedIds: string[];
};

export default function Nav({ selectedIds }: NavProps) {
  const cleanedIds = Array.from(
    new Set(selectedIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  );
  const graphHref =
    cleanedIds.length > 0
      ? `/graph?ids=${cleanedIds.map((id) => encodeURIComponent(id)).join(",")}`
      : "/graph";

  return (
    <nav
      className="mb-6 flex items-center justify-between rounded-2xl px-4 py-3 shadow-lg"
      style={{
        border: "1px solid var(--border-default)",
        backgroundColor: "var(--bg-surface)",
      }}
      aria-label="Main navigation"
    >
      <Link
        href="/"
        className="inline-flex items-center gap-2.5 rounded-full px-3 py-1.5 text-sm font-semibold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
        style={{ color: "var(--text-primary)" }}
      >
        <span
          className="flex h-6 w-6 items-center justify-center rounded-lg text-xs"
          style={{
            backgroundColor: "var(--cyan-subtle)",
            color: "var(--text-accent)",
            border: "1px solid rgba(6,182,212,0.3)",
          }}
          aria-hidden="true"
        >
          ⬡
        </span>
        <span className="font-bold">Scholytics</span>
      </Link>

      <Link
        href={graphHref}
        className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
        style={{
          backgroundColor: "var(--cyan-primary)",
          color: "var(--cyan-text)",
        }}
        aria-label={`Graph ${cleanedIds.length}`}
      >
        <span>Graph</span>
        <span
          className="inline-flex min-w-5 items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold"
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.25)",
            color: "inherit",
          }}
        >
          {cleanedIds.length}
        </span>
      </Link>
    </nav>
  );
}
