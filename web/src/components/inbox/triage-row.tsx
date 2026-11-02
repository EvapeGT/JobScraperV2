"use client";

import Link from "next/link";
import { Bookmark, BookmarkCheck, Loader2, X } from "lucide-react";
import type { InboxJob } from "@/lib/career-ops";
import type { InboxSource } from "@/lib/inbox";
import { sourceLabel, relativePostingDate, listingUrl } from "@/lib/core/listing-metadata.mjs";
import { unscoredInboxHref } from "@/lib/posting-url.mjs";
import { Badge } from "@/components/ui/badge";
import { CompanyLogo } from "@/components/company-logo";
import { cn } from "@/lib/cn";
import { inboxScoreTarget } from "@/lib/inbox-score-target.mjs";

export type RowScore = { score: number | null; tone: "good" | "warn" | "bad" | "muted"; jobId: string; running: boolean; reportN?: number | null };

// One raw posting in the triage list. Shows ONLY cheap, free signals + an honest
// "not scored" (CRUDA) — never a fake match%. Once its shortlist eval finishes it
// flips to EVALUADA (a real A–F badge). Save→shortlist / Skip→hidden are free + undoable.
export function TriageRow({
  job,
  source,
  now,
  scored,
  selected,
  shortlisted,
  onToggleSelect,
  onSave,
  onSkip,
}: {
  job: InboxJob;
  source: InboxSource | null;
  now: number;
  scored?: RowScore;
  selected: boolean;
  shortlisted: boolean;
  onToggleSelect: () => void;
  onSave: () => void;
  onSkip: () => void;
}) {
  const sources = job.listingSources?.length ? job.listingSources : listingUrl(job.url) ? [{ source, label: sourceLabel(source), url: job.url, postedAt: job.postedAt }] : [];
  const exactDate = job.postedAt ? `Posted ${job.postedAt}${job.postedSource ? ` via ${job.postedSource}` : ""}` : "Posting date unavailable";
  const target = inboxScoreTarget(scored);
  const evaluated = target.evaluated;
  const postingHref = unscoredInboxHref(job.url, evaluated);
  const title = (
    <>
      <span className="font-medium text-foreground">{job.company}</span>
      <span className="text-muted"> · {job.role}</span>
    </>
  );

  return (
    <li
      className={cn(
        "flex items-center gap-2.5 px-3 py-2.5 transition-colors sm:gap-3 sm:px-4",
        selected ? "bg-brand-soft/50" : "hover:bg-surface-hover",
        evaluated && "opacity-95",
      )}
    >
      {/* multi-select — power-user batch to shortlist */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        aria-label={`Select ${job.company} ${job.role}`}
        className="size-4 shrink-0 accent-brand max-sm:min-h-[44px] max-sm:min-w-[24px]"
      />

      <CompanyLogo name={job.company} size={20} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {postingHref ? (
            <a href={postingHref} target="_blank" rel="noreferrer" className="hover:text-brand">
              {title}
            </a>
          ) : (
            title
          )}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
          {job.location && <span className="truncate">{job.location}</span>}
          {job.postedAt ? <time dateTime={job.postedAt} title={exactDate} aria-label={exactDate}>{relativePostingDate(job.postedAt, now)}{job.postedSource ? ` on ${job.postedSource}` : ""}</time> : <span>Posting date unavailable</span>}
          {job.firstDiscoveredAt && <time dateTime={job.firstDiscoveredAt} title="Date first found by your scraper">First found {job.firstDiscoveredAt}</time>}
          {/* 🔴 CRUDA: honest "not scored" — no fabricated match%. */}
          {!evaluated && <span className="italic text-muted">not scored</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
          {sources.length ? <span>Listed on</span> : <span>Source unavailable</span>}
          {sources.map(s => <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer"
            title={`${s.label}${s.postedAt ? ` · Posted ${s.postedAt}` : " · Posting date unavailable"}`}
            className="rounded bg-surface-hover px-1 py-px font-medium hover:text-brand">{s.label}</a>)}
          {(job.applicationPlatforms || []).map(platform => <a key={platform.url} href={platform.url} target="_blank" rel="noopener noreferrer"
            title="Employer application page; availability unconfirmed" className="underline underline-offset-2 hover:text-brand">Employer page · {platform.label}</a>)}
        </div>
      </div>

      {/* EVALUADA state (right-aligned, visually distinct from raw rows) */}
      {evaluated && target.href ? (
        <Link href={target.href} className="flex shrink-0 items-center gap-1.5 text-xs">
          {scored!.running ? (
            <>
              <Loader2 className="size-3.5 animate-spin text-brand" />
              <span className="text-brand max-sm:hidden">Scoring…</span>
            </>
          ) : target.showScore ? (
            <Badge tone={scored!.tone}>{scored!.score}/5</Badge>
          ) : (
            <span className="text-brand">Report</span>
          )}
        </Link>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onSave}
            title={shortlisted ? "In your shortlist" : "Save to shortlist"}
            aria-pressed={shortlisted}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors max-sm:min-h-[44px] max-sm:min-w-[44px]",
              shortlisted ? "text-brand" : "text-muted hover:bg-surface-hover hover:text-brand",
            )}
          >
            {shortlisted ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
            <span className="max-sm:hidden">{shortlisted ? "Saved" : "Save"}</span>
          </button>
          <button
            type="button"
            onClick={onSkip}
            title="Skip — hide from the inbox"
            className="inline-flex items-center justify-center rounded-md p-1 text-faint transition-colors hover:bg-surface-hover hover:text-foreground max-sm:min-h-[44px] max-sm:min-w-[44px]"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </li>
  );
}
