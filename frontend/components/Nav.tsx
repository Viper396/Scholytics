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
    pathname =
      (typeof navigation.usePathname === "function"
        ? navigation.usePathname()
        : "/") ?? "/";
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
    <header className="sticky top-0 z-40 w-full border-b border-[#1d3658] bg-[#051424]/95 backdrop-blur-md">
      <div className="page-container flex h-16 items-center justify-between gap-4">
        {/* Brand & Main Route Links */}
        <div className="flex items-center gap-6 sm:gap-8">
          <Link
            href="/"
            className="group flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-label="Scholytics Home"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#1d3658] bg-[#0c1a2e] text-cyan-400 transition-colors group-hover:border-cyan-500/50 group-hover:text-cyan-300">
              <span className="text-base font-bold select-none" aria-hidden="true">
                ⬡
              </span>
            </div>

            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold tracking-tight text-[#f0f5fc]">
                  Scholytics
                </span>
                <span className="hidden sm:inline-block rounded border border-[#1d3658] bg-[#11233d] px-1.5 py-0.5 font-mono text-[10px] font-medium text-cyan-400">
                  arXiv Discovery
                </span>
              </div>
              <span className="hidden md:inline text-[11px] text-[#9cb3cf]">
                Semantic Research Discovery
              </span>
            </div>
          </Link>

          {/* Navigation Route Tabs */}
          <nav className="flex items-center gap-1" aria-label="Main Navigation">
            <Link
              href="/"
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                isDiscover
                  ? "bg-[#11233d] text-cyan-400 border border-[#1d3658]"
                  : "text-[#9cb3cf] hover:bg-[#11233d]/70 hover:text-[#f0f5fc]"
              }`}
            >
              Discover
            </Link>
            <Link
              href={graphHref}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                isGraph
                  ? "bg-[#11233d] text-cyan-400 border border-[#1d3658]"
                  : "text-[#9cb3cf] hover:bg-[#11233d]/70 hover:text-[#f0f5fc]"
              }`}
            >
              Relationship Graph
            </Link>
          </nav>
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center gap-2.5">
          {/* Saved papers drawer trigger */}
          {onOpenSaved ? (
            <button
              type="button"
              onClick={onOpenSaved}
              className="inline-flex items-center gap-2 rounded-lg border border-[#1d3658] bg-[#0c1a2e] px-3 py-1.5 text-xs font-medium text-[#9cb3cf] transition-colors hover:border-[#2b4f7c] hover:bg-[#11233d] hover:text-[#f0f5fc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              aria-label={`Reading list (${savedCount ?? 0} saved)`}
            >
              <span aria-hidden="true" className="text-amber-400 text-xs">★</span>
              <span className="hidden sm:inline">Saved</span>
              <span className="rounded bg-[#11233d] px-1.5 py-0.2 font-mono text-[11px] font-semibold text-amber-400 border border-[#1d3658]">
                {savedCount ?? 0}
              </span>
            </button>
          ) : savedCount !== undefined ? (
            <div className="hidden sm:inline-flex items-center gap-2 rounded-lg border border-[#1d3658] bg-[#0c1a2e] px-3 py-1.5 text-xs font-medium text-[#9cb3cf]">
              <span aria-hidden="true" className="text-amber-400 text-xs">★</span>
              <span>Saved</span>
              <span className="rounded bg-[#11233d] px-1.5 py-0.2 font-mono text-[11px] font-semibold text-amber-400 border border-[#1d3658]">
                {savedCount}
              </span>
            </div>
          ) : null}

          {/* Primary Graph Navigation Link */}
          <Link
            href={graphHref}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-3.5 py-1.5 text-xs font-bold text-[#04121e] transition-colors hover:bg-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            aria-label={`Graph ${cleanedIds.length}`}
          >
            <span aria-hidden="true" className="text-xs">◈</span>
            <span>Graph</span>
            <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-[#04121e]/20 px-1.5 py-0.5 font-mono text-[11px] font-extrabold text-[#04121e]">
              {cleanedIds.length}
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
