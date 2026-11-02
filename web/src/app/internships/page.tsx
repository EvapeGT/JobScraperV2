import Link from "next/link";
import { careerOpsRoot } from "@/lib/career-ops";
import { discoveryRequest, discoveryUrl } from "@/lib/core/discovery.mjs";
import { DiscoveryControls } from "@/components/discovery-controls";

export const dynamic = "force-dynamic";

export default async function InternshipsPage() {
  let data;
  try { data = await discoveryRequest({ root: careerOpsRoot() }); }
  catch { return <div className="mx-auto max-w-5xl space-y-4 px-6 py-10 max-sm:pb-28"><h1 className="font-serif text-4xl text-landing">Internship discovery</h1><p className="text-muted">The combined collector is not running. Use Start Internship Desk to start both the original dashboard and its discovery service.</p><DiscoveryControls /></div>; }
  const index = data.index;
  const sources = data.sources;
  const native = sources.native?.receipt;
  const spy = sources.jobspy;
  const street = sources.jobstreet;
  const generated = index?.generated_at ? new Date(index.generated_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "No saved search yet";
  return <div className="mx-auto max-w-5xl px-6 py-10 max-sm:pb-28">
    <h1 className="font-serif text-4xl text-landing">Internship discovery</h1>
    <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">Java / Spring Boot and cloud / DevOps internships, newest postings first. Metro Manila, any work arrangement; confirm the 486-hour school requirement, MOA and start date with each company.</p>
    <div className="mt-7 flex flex-wrap gap-x-7 gap-y-3 border-y border-border py-4 text-sm text-muted">
      <span><strong className="tabular-nums text-foreground">{index?.metrics.ranked_leads ?? 0}</strong> ranked leads</span>
      <span><strong className="tabular-nums text-foreground">{index?.metrics.canonical_roles ?? 0}</strong> saved roles</span>
      <span><strong className="tabular-nums text-foreground">{index?.metrics.duplicate_source_listings ?? 0}</strong> duplicate records consolidated</span>
      <span><strong className="tabular-nums text-foreground">{index?.metrics.tracked_leads ?? 0}</strong> already in your tracker</span>
      <span>Updated {generated} · Manila</span>
    </div>
    <div className="mt-7"><DiscoveryControls /></div>
    {sources.failed && <p className="mt-4 rounded-md border border-amber-600/30 bg-amber-600/10 p-3 text-sm text-amber-900 dark:text-amber-200">The latest source search was partial. Saved roles remain available; inspect source health before treating results as fresh.</p>}
    <section className="mt-10 space-y-4">
      <h2 className="text-xl font-semibold">Use the full Career-ops workflow</h2>
      <p className="max-w-3xl text-sm leading-relaxed text-muted">Open the inbox, save a role, then choose Full evaluation and score it against your CV. Open its report for the real 1–5 fit score, ATS keywords, gaps, interview preparation and tailored CV generation. Resume files are drafts for your review.</p>
      <p className="max-w-3xl text-sm leading-relaxed text-muted">For collected roles whose website cannot be read, select Use saved job descriptions before scoring. Career-ops evaluates the captured text and labels availability unconfirmed; check the employer’s listing before applying.</p>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/pipeline?tab=INBOX" className="rounded-md bg-brand px-4 py-2.5 font-semibold text-brand-foreground hover:bg-brand-200">Review &amp; score inbox</Link>
        <Link href="/cv" className="rounded-md border border-border px-4 py-2.5 hover:bg-surface-hover">Your source CV</Link>
        <Link href="/documents" className="rounded-md border border-border px-4 py-2.5 hover:bg-surface-hover">Documents</Link>
        <a href={discoveryUrl()} target="_blank" rel="noopener noreferrer" className="rounded-md border border-border px-4 py-2.5 hover:bg-surface-hover">Detailed discovery results</a>
      </div>
      <p className="max-w-3xl text-xs leading-relaxed text-muted">The discovery view’s 0–100 keyword priority is separate from the full CV-aware 1–5 evaluation. Refresh never applies, uploads documents, sends messages, or creates reminders.</p>
    </section>
    <section className="mt-10 border-t border-border pt-6">
      <h2 className="text-xl font-semibold">Latest source health</h2>
      <dl className="mt-4 grid gap-5 text-sm sm:grid-cols-2">
        <div><dt className="font-medium">Career-ops company sources</dt><dd className="mt-1 leading-relaxed text-muted">{native ? `${native.scanned} sources · ${native.found} listings before screening · ${native.errors?.length || 0} reported errors` : "No native scan receipt saved yet."}</dd></div>
        <div><dt className="font-medium">JobSpy: Indeed + LinkedIn</dt><dd className="mt-1 leading-relaxed text-muted">{spy ? `${spy.unique_listings} unique listings in the last run · ${spy.queries_with_errors} queries with errors` : "No completed JobSpy search saved yet."}</dd></div>
        <div><dt className="font-medium">JobStreet Philippines</dt><dd className="mt-1 leading-relaxed text-muted">{street ? `${street.records} source records · ${street.full_descriptions} relevant descriptions · ${street.errors.length} reported issues` : "JobStreet will be searched on the next refresh."}</dd></div>
      </dl>
      {!!spy?.queries_at_result_limit && <p className="mt-4 text-sm text-muted">Coverage is bounded: {spy.queries_at_result_limit} Indeed/LinkedIn searches reached their result caps. Additional listings may exist; a successful refresh is not an exhaustive search.</p>}
      {sources.source_audit && <div className="mt-4 space-y-2 text-xs text-muted">
        <p>Current refresh, before filtering → qualifying roles → newly qualifying roles. Cross-posts can appear under multiple sources.</p>
        {sources.source_audit.sources.map((source: { source: string; retrieved_unique: number; surviving_roles: number; new_ranked_roles: number; missing_descriptions: number }) => <p key={source.source}>
          {source.source === "jobstreet" ? "JobStreet" : source.source === "indeed" ? "Indeed" : "LinkedIn"}: {source.retrieved_unique} → {source.surviving_roles} → {source.new_ranked_roles}
          {source.missing_descriptions > 0 ? ` · ${source.missing_descriptions} raw records lack full descriptions` : " · descriptions available"}
        </p>)}
      </div>}
    </section>
  </div>;
}
