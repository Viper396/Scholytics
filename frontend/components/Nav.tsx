"use client";

import React from "react";
import Link from "next/link";
import * as navigation from "next/navigation";

type NavProps = {
  selectedIds: string[];
  savedCount?: number;
  onOpenSaved?: () => void;
};

export default function Nav({ selectedIds, savedCount, onOpenSaved }: NavProps) {
  let pathname = "/";
  try {
    pathname = (typeof navigation.usePathname === "function" ? navigation.usePathname() : "/") ?? "/";
  } catch {
    pathname = "/";
  }
  const cleanedIds = Array.from(
    new Set(selectedIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  );
  const graphHref =
    cleanedIds.length > 0
      ? `/graph?ids=${cleanedIds.map((id) => encodeURIComponent(id)).join(",")}`
      : "/graph";

  const isDiscover = pathname === "/" || pathname === "";
  const isGraph = pathname?.startsWith("/graph");

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#1e385c]/60 bg-[#051424]/90 backdrop-blur-xl">
      <div className="page-container flex h-16 items-center justify-between gap-4">
        {/* Brand & Left Navigation */}
        <div className="flex items-center gap-6 md:gap-8">
          <Link
            href="/"
            className="group flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-label="Scholytics Home"
          >
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-[#1e385c] bg-[#0c1a2e] shadow-[0_0_12px_rgba(34,211,238,0.2)] transition-all group-hover:border-cyan-500/50 group-hover:shadow-[0_0_18px_rgba(34,211,238,0.35)]">
              <span className="text-base text-cyan-400 font-bold" aria-hidden="true">
                ⬡
              </span>
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            </div>

            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold tracking-tight text-[#eaf2ff]">
                  Scholytics
                </span>
                <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-400">
                  RESEARCH
                </span>
              </div>
              <span className="hidden sm:inline text-[11px] font-normal tracking-wide text-[#9cb1ce] uppercase">
                Semantic Research Discovery
              </span>
            </div>
          </Link>

          {/* Navigation Route Tabs */}
          <nav className="hidden md:flex items-center gap-1.5" aria-label="Main Navigation">
            <Link
              href="/"
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                isDiscover
                  ? "bg-[#11223b] text-cyan-400 border border-[#1e385c] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
                  : "text-[#9cb1ce] hover:bg-[#11223b]/60 hover:text-[#eaf2ff]"
              }`}
            >
              Discover
            </Link>
            <Link
              href={graphHref}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                isGraph
                  ? "bg-[#11223b] text-cyan-400 border border-[#1e385c] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
                  : "text-[#9cb1ce] hover:bg-[#11223b]/60 hover:text-[#eaf2ff]"
              }`}
            >
              Relationship Graph
            </Link>
          </nav>
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          {/* Saved papers drawer trigger (if on home or counter present) */}
          {onOpenSaved ? (
            <button
              type="button"
              onClick={onOpenSaved}
              className="inline-flex items-center gap-2 rounded-xl border border-[#1e385c] bg-[#0c1a2e] px-3 py-1.5 text-xs font-medium text-[#9cb1ce] transition-all hover:border-cyan-500/40 hover:bg-[#11223b] hover:text-[#eaf2ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              aria-label={`Reading list (${savedCount ?? 0} saved)`}
            >
              <span aria-hidden="true" className="text-amber-400 text-sm">★</span>
              <span className="hidden sm:inline font-medium">Saved</span>
              <span className="rounded-full bg-[#11223b] px-1.5 py-0.2 font-mono text-[11px] font-bold text-amber-400 border border-[#1e385c]">
                {savedCount ?? 0}
              </span>
            </button>
          ) : savedCount !== undefined ? (
            <div className="hidden sm:inline-flex items-center gap-2 rounded-xl border border-[#1e385c] bg-[#0c1a2e] px-3 py-1.5 text-xs font-medium text-[#9cb1ce]">
              <span aria-hidden="true" className="text-amber-400 text-sm">★</span>
              <span>Saved</span>
              <span className="rounded-full bg-[#11223b] px-1.5 py-0.2 font-mono text-[11px] font-bold text-amber-400 border border-[#1e385c]">
                {savedCount}
              </span>
            </div>
          ) : null}

          {/* Primary Graph Navigation Link with Accessible Label matching test: /graph <count>/i */}
          <Link
            href={graphHref}
            className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-500 px-3.5 sm:px-4 py-1.5 text-xs font-bold text-[#04121e] shadow-[0_0_16px_rgba(34,211,238,0.25)] transition-all hover:from-cyan-300 hover:to-cyan-400 hover:shadow-[0_0_24px_rgba(34,211,238,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-label={`Graph ${cleanedIds.length}`}
          >
            <span aria-hidden="true" className="text-sm">◈</span>
            <span className="font-bold">Graph</span>
            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#04121e]/25 px-1.5 py-0.5 font-mono text-[11px] font-black text-[#04121e]">
              {cleanedIds.length}
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
