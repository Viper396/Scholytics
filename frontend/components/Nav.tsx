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
    <header className="sticky top-0 z-40 w-full border-b border-[#294058] bg-[#07111d]/95 backdrop-blur-md">
      <div className="page-container flex h-16 items-center justify-between gap-4">
        {/* Brand & Main Route Links */}
        <div className="flex items-center gap-4 sm:gap-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24c6d8]"
            aria-label="Scholytics Home"
          >
            {/* Book/Grid Brand Icon */}
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#294058] bg-[#101e30] text-[#24c6d8]">
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
                <path d="M6 6h10" />
                <path d="M6 10h10" />
              </svg>
            </div>

            <span className="text-lg font-bold tracking-tight text-[#eaf2f8]">
              Scholytics
            </span>
          </Link>

          {/* Vertical Separator */}
          <div className="hidden sm:block h-5 w-px bg-[#294058]" aria-hidden="true" />

          {/* Navigation Route Tabs */}
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main Navigation">
            <Link
              href="/"
              aria-current={isDiscover ? "page" : undefined}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                isDiscover
                  ? "text-[#eaf2f8] font-semibold after:absolute after:bottom-[-8px] after:left-0 after:right-0 after:h-[2px] after:bg-[#24c6d8] after:rounded-full"
                  : "text-[#a7bacd] hover:text-[#eaf2f8]"
              }`}
            >
              <svg
                className="h-3.5 w-3.5 text-[#a7bacd]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span>Discover</span>
            </Link>

            <Link
              href={graphHref}
              aria-current={isGraph ? "page" : undefined}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                isGraph
                  ? "text-[#24c6d8] font-semibold border border-[#24c6d8]/40 rounded-lg bg-[#14263a] after:absolute after:bottom-[-9px] after:left-0 after:right-0 after:h-[2px] after:bg-[#24c6d8]"
                  : "text-[#a7bacd] hover:text-[#eaf2f8]"
              }`}
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="6" cy="6" r="3" />
                <circle cx="18" cy="18" r="3" />
                <path d="m8.5 8.5 7 7" />
                <circle cx="18" cy="6" r="3" />
                <path d="m15.5 8.5-7 7" />
              </svg>
              <span className="hidden sm:inline">Relationship Graph</span>
              <span className="sm:hidden">Graph</span>
            </Link>
          </nav>
        </div>

        {/* Right Action Controls: Saved & Graph pills */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Saved papers drawer trigger */}
          {onOpenSaved ? (
            <button
              type="button"
              onClick={onOpenSaved}
              className="inline-flex items-center gap-2 rounded-lg border border-[#294058] bg-[#101e30] px-3 py-1.5 text-xs font-medium text-[#a7bacd] transition-colors hover:border-[#3d5a7a] hover:bg-[#14263a] hover:text-[#eaf2f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24c6d8]"
              aria-label={`Reading list (${savedCount ?? 0} saved)`}
            >
              <svg
                className="h-3.5 w-3.5 text-[#a7bacd]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              <span className="hidden sm:inline">Saved</span>
              <span className="rounded bg-[#14263a] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#eaf2f8] border border-[#294058]">
                {savedCount ?? 0}
              </span>
            </button>
          ) : savedCount !== undefined ? (
            <div className="hidden sm:inline-flex items-center gap-2 rounded-lg border border-[#294058] bg-[#101e30] px-3 py-1.5 text-xs font-medium text-[#a7bacd]">
              <svg
                className="h-3.5 w-3.5 text-[#a7bacd]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              <span>Saved</span>
              <span className="rounded bg-[#14263a] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#eaf2f8] border border-[#294058]">
                {savedCount}
              </span>
            </div>
          ) : null}

          {/* Primary Graph Navigation Link */}
          <Link
            href={graphHref}
            className="inline-flex items-center gap-2 rounded-lg border border-[#294058] bg-[#101e30] px-3 py-1.5 text-xs font-medium text-[#eaf2f8] transition-colors hover:border-[#24c6d8] hover:bg-[#14263a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#24c6d8]"
            aria-label={`Graph ${cleanedIds.length}`}
          >
            <svg
              className="h-3.5 w-3.5 text-[#24c6d8]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="18" r="3" />
              <path d="m8.5 8.5 7 7" />
              <circle cx="18" cy="6" r="3" />
              <path d="m15.5 8.5-7 7" />
            </svg>
            <span className="font-semibold">Graph</span>
            <span className="rounded bg-[#14263a] px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#24c6d8] border border-[#294058]">
              {cleanedIds.length}
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
