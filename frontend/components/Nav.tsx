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
    <nav className="mb-6 flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-800/80 px-4 py-3 shadow-lg shadow-slate-950/20">
      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold tracking-wide text-slate-100 transition hover:bg-slate-700"
      >
        <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
        Scholytics
      </Link>

      <Link
        href={graphHref}
        className="inline-flex items-center gap-2 rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
      >
        <span>Graph</span>
        <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-slate-900 px-2 py-0.5 text-xs font-bold text-cyan-200">
          {cleanedIds.length}
        </span>
      </Link>
    </nav>
  );
}
