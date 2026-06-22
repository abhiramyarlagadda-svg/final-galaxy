import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Briefcase,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  Database,
  ExternalLink,
  Globe2,
  Key,
  MapPin,
  Radar,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { fetchJobs, KNOWN_COUNTRIES, type ExperienceLevel, type Job } from './lib/radarClient';
import {
  fetchAIJobs,
  getAnthropicKey,
  hasAnthropicKey,
  setAnthropicKey,
} from './lib/claudeClient';
import {
  clearCache,
  latestPostedAt,
  readAllCached,
  writeCached,
} from './lib/cache';

const PAGE_SIZE = 20;

const EXPERIENCE_OPTIONS: { value: ExperienceLevel; label: string }[] = [
  { value: 'Internship', label: 'Internship' },
  { value: 'Entry', label: 'Entry (0-1 yrs)' },
  { value: 'Mid', label: 'Mid (2-4 yrs)' },
  { value: 'Senior', label: 'Senior (5-8 yrs)' },
  { value: 'Lead', label: 'Lead / Principal (9+)' },
  { value: 'Unknown', label: 'Unspecified' },
];

type DateRange = 'all' | '24h' | '3d' | '7d';
const DATE_OPTIONS: { value: DateRange; label: string; days: number | null }[] = [
  { value: 'all', label: 'Any time', days: null },
  { value: '24h', label: 'Last 24 hours', days: 1 },
  { value: '3d', label: 'Last 3 days', days: 3 },
  { value: '7d', label: 'Last 7 days', days: 7 },
];

interface Toast {
  message: string;
  kind: 'success' | 'error' | 'info';
}

export default function App() {
  const [technology, setTechnology] = useState('');
  const [country, setCountry] = useState<string>('All');
  const [experienceSet, setExperienceSet] = useState<Set<ExperienceLevel>>(new Set());
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [role, setRole] = useState<string>('All');

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);   // true only until FIRST batch arrives
  const [streaming, setStreaming] = useState(false); // true while more batches come in
  const [newCount, setNewCount] = useState(0);    // newly-fetched (delta) since cache hydrate
  const [hydratedFromCache, setHydratedFromCache] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<Toast | null>(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  /* ------------------------------------------------------------------ */
  /*                              Loaders                               */
  /* ------------------------------------------------------------------ */
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Generic stream-fetch helper. When `mode === 'replace'` the prior list is
   * wiped first (used for keyword search). When `mode === 'merge'` new rows
   * are merged into the existing list and persisted to IndexedDB (used for
   * cache-hydrate refreshes).
   */
  async function streamFetch(opts: {
    technology: string;
    country: string;
    sincePostedAt?: string | null;
    mode: 'replace' | 'merge';
    persist: boolean;
    // Pace subsequent batches so the first render isn't drowned by a flood
    // of follow-up fetches. 0 = no throttling.
    throttleMs?: number;
  }) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setStreaming(true);
    if (opts.mode === 'replace') {
      setLoading(true);
      setJobs([]);
      setPage(1);
    }
    setNewCount(0);
    let firstBatchSeen = false;
    const collected: Job[] = [];

    try {
      await fetchJobs({
        technology: opts.technology,
        country: opts.country,
        sincePostedAt: opts.sincePostedAt ?? null,
        signal: ctrl.signal,
        interBatchDelayMs: opts.throttleMs ?? 0,
        onBatch: (batch) => {
          if (ctrl.signal.aborted) return;
          collected.push(...batch);
          if (opts.mode === 'replace') {
            setJobs((prev) => prev.concat(batch));
          } else {
            // Merge by id; new jobs go to the top (latest first).
            setJobs((prev) => {
              const seen = new Set(prev.map((j) => j.id));
              const fresh = batch.filter((j) => !seen.has(j.id));
              setNewCount((c) => c + fresh.length);
              return [...fresh, ...prev];
            });
          }
          if (!firstBatchSeen) {
            firstBatchSeen = true;
            setLoading(false);
          }
        },
      });
      if (opts.persist && collected.length > 0) {
        await writeCached(collected);
      }
    } catch (err) {
      if (ctrl.signal.aborted) return;
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: 'error', message: `Could not load jobs: ${msg}` });
    } finally {
      if (!ctrl.signal.aborted) {
        setLoading(false);
        setStreaming(false);
      }
    }
  }

  /** Keyword/country re-search. With no filters we restore the cache + delta. */
  async function load(opts?: { tech?: string; country?: string }) {
    const tech = (opts?.tech ?? technology).trim();
    const ctry = opts?.country && opts.country !== 'All' ? opts.country : '';

    if (!tech && !ctry) {
      // No filters — fall back to the cached base view and delta-fetch.
      const cached = await readAllCached();
      if (cached.length > 0) {
        setJobs(cached);
        setLoading(false);
        setHydratedFromCache(true);
        setPage(1);
        await streamFetch({
          technology: '',
          country: '',
          sincePostedAt: latestPostedAt(cached),
          mode: 'merge',
          persist: true,
        });
        return;
      }
    }

    // Filtered query — always hit Supabase, replace the list, don't pollute cache.
    await streamFetch({
      technology: tech,
      country: ctry,
      mode: 'replace',
      persist: false,
    });
  }

  /** Force a full refetch and replace the cache. */
  async function refreshAll() {
    await clearCache();
    setJobs([]);
    await streamFetch({
      technology: '',
      country: '',
      mode: 'replace',
      persist: true,
      throttleMs: 800, // background-fetch after first batch renders
    });
    setToast({ kind: 'success', message: 'Cache refreshed from scratch.' });
  }

  /** Hydrate from IndexedDB on first mount, then delta-fetch only new postings. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await readAllCached();
      if (cancelled) return;
      if (cached.length > 0) {
        // Show cached jobs immediately — no spinner, no empty state.
        setJobs(cached);
        setLoading(false);
        setHydratedFromCache(true);
        const since = latestPostedAt(cached);
        // Pull only jobs newer than the most-recent cached posted_at.
        // Delta is small — no throttling needed.
        await streamFetch({
          technology: '',
          country: '',
          sincePostedAt: since,
          mode: 'merge',
          persist: true,
        });
      } else {
        // Cold start — fetch the first 1000 fast (renders immediately), then
        // pace subsequent batches so the UI stays interactive while the rest
        // streams in the background.
        await streamFetch({
          technology: '',
          country: '',
          mode: 'replace',
          persist: true,
          throttleMs: 800,
        });
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedJob) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedJob(null);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [selectedJob]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    load();
  }

  async function handleAIBoost() {
    if (!hasAnthropicKey()) {
      setKeyDraft('');
      setShowKeyModal(true);
      return;
    }
    setAiLoading(true);
    try {
      const ai = await fetchAIJobs({
        technology: technology.trim(),
        country: country === 'All' ? '' : country,
      });
      if (ai.length === 0) {
        setToast({ kind: 'info', message: 'Claude returned no fresh listings — try a different query.' });
      } else {
        setJobs((prev) => {
          const existingIds = new Set(prev.map((j) => j.id));
          const merged = [...ai.filter((j) => !existingIds.has(j.id)), ...prev];
          return merged;
        });
        setPage(1);
        setToast({
          kind: 'success',
          message: `Claude added ${ai.length} freshly-sourced roles to the top of your feed.`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: 'error', message: `AI boost failed: ${msg}` });
    } finally {
      setAiLoading(false);
    }
  }

  function saveKey() {
    if (!keyDraft.trim()) {
      setToast({ kind: 'error', message: 'Paste a valid Anthropic API key.' });
      return;
    }
    setAnthropicKey(keyDraft.trim());
    setShowKeyModal(false);
    setToast({ kind: 'success', message: 'Anthropic key saved locally. AI boost is live.' });
  }

  /* ------------------------------------------------------------------ */
  /*                         Derived UI state                           */
  /* ------------------------------------------------------------------ */
  const countries = useMemo(() => {
    const present = new Set<string>();
    jobs.forEach((j) => present.add(j.country));
    // Only real countries (from the allow-list) — never cities.
    const real = KNOWN_COUNTRIES.filter((c) => present.has(c));
    const list = ['All', ...real];
    if (present.has('Other')) list.push('Other');
    return list;
  }, [jobs]);

  const roles = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach((j) => j.role && set.add(j.role));
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [jobs]);

  const filtered = useMemo(() => {
    const days = DATE_OPTIONS.find((d) => d.value === dateRange)?.days ?? null;
    const cutoff = days !== null ? Date.now() - days * 86_400_000 : null;
    const out = jobs.filter((j) => {
      if (country !== 'All' && j.country !== country) return false;
      if (experienceSet.size > 0 && !experienceSet.has(j.experienceLevel)) return false;
      if (role !== 'All' && j.role !== role) return false;
      if (cutoff !== null) {
        if (!j.postedAt) return false;
        const t = new Date(j.postedAt).getTime();
        if (isNaN(t) || t < cutoff) return false;
      }
      return true;
    });
    // Sort newest first. Jobs without a posted_at drop to the bottom so the
    // top of the list always reflects the freshest postings.
    out.sort((a, b) => {
      const ta = a.postedAt ? new Date(a.postedAt).getTime() : -Infinity;
      const tb = b.postedAt ? new Date(b.postedAt).getTime() : -Infinity;
      return tb - ta;
    });
    return out;
  }, [jobs, country, experienceSet, role, dateRange]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const aiCount = jobs.filter((j) => j.isAI).length;

  /* ------------------------------------------------------------------ */
  /*                                Render                              */
  /* ------------------------------------------------------------------ */
  return (
    <div className="app">
      {/* HERO */}
      <header className="hero">
        <div className="hero-grid">
          <div className="brand">
            <div className="brand-logo">
              <Radar size={26} strokeWidth={2.4} />
            </div>
            <div>
              <h1>Job Radar</h1>
              <p>Live jobs from Supabase + Claude AI</p>
            </div>
          </div>
          <div className="hero-actions">
            <button
              className="btn btn-ghost"
              onClick={refreshAll}
              disabled={streaming || loading}
              title="Clear local cache and re-fetch every job"
            >
              <RefreshCw size={16} className={streaming ? 'spin' : undefined} />
              Refresh
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setKeyDraft(getAnthropicKey());
                setShowKeyModal(true);
              }}
            >
              <Key size={16} />
              {hasAnthropicKey() ? 'AI key set' : 'Connect AI'}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleAIBoost}
              disabled={aiLoading}
            >
              <Sparkles size={16} />
              {aiLoading ? 'Asking Claude…' : 'Boost with Claude'}
            </button>
          </div>
        </div>

        <motion.div
          className="title-block"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h2>
            Discover roles from a <span className="accent">live job lake</span>,
            filtered the way <em>you</em> work.
          </h2>
          <p>
            Search a vast Supabase-backed catalogue, slice by country and experience,
            then let Claude top your feed with freshly-posted listings.
          </p>
          <div className="stats">
            <span className="stat-pill">
              <span className="dot-pulse" />
              <strong>{jobs.length.toLocaleString()}</strong>{' '}
              {streaming
                ? hydratedFromCache
                  ? 'jobs · syncing new postings…'
                  : 'jobs · loading more in background…'
                : 'jobs loaded'}
            </span>
            {hydratedFromCache && (
              <span className="stat-pill">
                <Database size={14} />
                cached · <strong>{newCount}</strong> new this visit
              </span>
            )}
            <span className="stat-pill">
              <Globe2 size={14} />
              <strong>{countries.length - 1}</strong> countries
            </span>
            <span className="stat-pill">
              <Sparkles size={14} />
              <strong>{aiCount}</strong> AI-sourced
            </span>
            <span className="stat-pill">
              <Target size={14} />
              source: <strong>Supabase · Adzuna · Claude</strong>
            </span>
          </div>
        </motion.div>
      </header>

      {/* FILTERS */}
      <form className="filter-bar" onSubmit={handleSearch}>
        <div className="filter-card">
          <div className="field">
            <label>Keyword / Technology</label>
            <div className="input-wrap">
              <Search size={16} />
              <input
                className="input"
                placeholder='Try "React", "Data engineer", "Java"…'
                value={technology}
                onChange={(e) => setTechnology(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label>Country</label>
            <div className="input-wrap">
              <Globe2 size={16} />
              <select
                className="select"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {c === 'All' ? 'All countries' : c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Posted</label>
            <div className="input-wrap">
              <Clock size={16} />
              <select
                className="select"
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as DateRange)}
              >
                {DATE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Experience</label>
            <MultiSelect
              icon={<Briefcase size={16} />}
              options={EXPERIENCE_OPTIONS}
              selected={experienceSet}
              onChange={setExperienceSet}
              placeholder="All levels"
            />
          </div>
          <div className="field">
            <label>Role family</label>
            <div className="input-wrap">
              <Compass size={16} />
              <select
                className="select"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r === 'All' ? 'All roles' : r}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="submit-cell">
            <button className="submit-btn" type="submit" disabled={loading}>
              <Search size={16} />
              {loading ? 'Scanning…' : streaming ? 'Search (streaming)' : 'Search'}
            </button>
          </div>
        </div>
      </form>

      {/* RESULTS */}
      <section className="results">
        <div className="results-header">
          <h3>
            <span>{filtered.length}</span> matching role{filtered.length === 1 ? '' : 's'}
            {country !== 'All' && ` · ${country}`}
            {experienceSet.size > 0 && ` · ${Array.from(experienceSet).join(' / ')}`}
            {dateRange !== 'all' && ` · ${DATE_OPTIONS.find((d) => d.value === dateRange)?.label}`}
          </h3>
          <div className="sort-group">
            Page <strong style={{ color: 'var(--green-700)', margin: '0 4px' }}>{safePage}</strong> of {totalPages}
          </div>
        </div>

        {loading ? (
          <div className="grid">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton-card" />
            ))}
          </div>
        ) : pageItems.length === 0 ? (
          <EmptyState onReset={() => { setTechnology(''); setCountry('All'); setExperienceSet(new Set()); setDateRange('all'); setRole('All'); load({ tech: '', country: '' }); }} />
        ) : (
          <>
            <motion.div
              className="grid"
              initial="hidden"
              animate="show"
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.04 } },
              }}
            >
              <AnimatePresence mode="popLayout">
                {pageItems.map((job) => (
                  <JobCard key={job.id} job={job} onSelect={setSelectedJob} />
                ))}
              </AnimatePresence>
            </motion.div>

            <Pagination
              page={safePage}
              totalPages={totalPages}
              onChange={(p) => {
                setPage(p);
                window.scrollTo({ top: 320, behavior: 'smooth' });
              }}
            />
          </>
        )}
      </section>

      <footer className="footer">
        Data is fetched live from Supabase URL{' '}
        <code style={{ background: 'var(--green-50)', padding: '2px 6px', borderRadius: 6 }}>
          owsbrhyzkprqgasesbqa.supabase.co
        </code>{' '}
        · AI suggestions powered by Anthropic Claude.
      </footer>

      {/* JOB DETAIL DRAWER */}
      <JobDrawer job={selectedJob} onClose={() => setSelectedJob(null)} />

      {/* SETTINGS MODAL */}
      <AnimatePresence>
        {showKeyModal && (
          <motion.div
            className="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowKeyModal(false)}
          >
            <motion.div
              className="modal"
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3>Connect Claude</h3>
              <p className="muted">
                Paste an Anthropic API key to enable AI-sourced listings. The key is
                stored locally in your browser — never sent to a server.
              </p>
              <label>Anthropic API key</label>
              <input
                className="modal-input"
                type="password"
                placeholder="sk-ant-..."
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                autoFocus
              />
              <div className="modal-actions">
                <button className="btn btn-ghost" onClick={() => setShowKeyModal(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={saveKey}>
                  <Key size={14} /> Save key
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* TOAST */}
      <AnimatePresence>
        {toast && (
          <motion.div
            className={`toast ${toast.kind}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
          >
            {toast.kind === 'success' && <Sparkles size={16} />}
            {toast.kind === 'error' && <X size={16} />}
            <span>{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ====================================================================== */
/*                              SUB-COMPONENTS                            */
/* ====================================================================== */

function JobCard({ job, onSelect }: { job: Job; onSelect: (j: Job) => void }) {
  const posted = job.postedAt
    ? new Date(job.postedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  const experienceLabel =
    job.experienceLevel === 'Unknown'
      ? 'Experience N/A'
      : job.experienceYears
      ? `${job.experienceLevel} · ${job.experienceYears}y`
      : job.experienceLevel;

  const initials = job.company
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '·';

  return (
    <motion.article
      layout
      className="job-card"
      variants={{
        hidden: { opacity: 0, y: 14 },
        show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.2, 0.7, 0.2, 1] } },
      }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
      onClick={() => onSelect(job)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(job);
        }
      }}
    >
      <div className="job-card-head">
        <div className="job-logo" aria-hidden>{initials}</div>
        <div className="job-card-head-text">
          <h4 className="job-title" title={job.title}>{job.title}</h4>
          <p className="job-company">
            <Building2 size={12} />
            {job.company}
          </p>
          <div className="job-meta">
            <span className="meta-chip">
              <MapPin size={11} />
              {job.country}
              {job.location && job.location !== job.country && job.location !== '—' && (
                ` · ${job.location.split(',')[0]}`
              )}
            </span>
            <span className="meta-chip exp">
              <Briefcase size={11} />
              {experienceLabel}
            </span>
            <span className="meta-chip">
              <Compass size={11} />
              {job.role}
            </span>
          </div>
        </div>
      </div>

      <div className="job-middle">
        {job.description && (
          <p className="job-desc">{cleanDescription(job.description)}</p>
        )}
        <span className="job-date">
          <Calendar size={11} />
          {posted ?? 'Date n/a'}
        </span>
      </div>

      <div className="job-right">
        <span className={`job-source-tag ${job.isAI ? 'ai' : ''}`}>
          {job.isAI ? <Sparkles size={10} /> : <Radar size={10} />}
          {job.platform || job.source}
        </span>
        {job.applyUrl ? (
          <a
            className="apply-link"
            href={job.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            Apply <ExternalLink size={11} />
          </a>
        ) : (
          <span className="apply-link" style={{ opacity: 0.6, cursor: 'default' }}>No link</span>
        )}
      </div>
    </motion.article>
  );
}

function cleanDescription(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260) + (text.length > 260 ? '…' : '');
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="state">
      <div className="state-icon">
        <Search size={28} />
      </div>
      <h4>No jobs match those filters</h4>
      <p>Loosen a filter, try a broader keyword, or let Claude search.</p>
      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onReset}>
        Clear filters
      </button>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages: (number | 'gap')[] = [];
  const add = (p: number | 'gap') => pages.push(p);
  const window = 1;
  add(1);
  if (page - window > 2) add('gap');
  for (let p = Math.max(2, page - window); p <= Math.min(totalPages - 1, page + window); p++) add(p);
  if (page + window < totalPages - 1) add('gap');
  if (totalPages > 1) add(totalPages);

  return (
    <nav className="pagination" aria-label="Pagination">
      <button className="page-btn" disabled={page === 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft size={14} /> Prev
      </button>
      {pages.map((p, i) =>
        p === 'gap' ? (
          <span key={`gap-${i}`} className="page-ellipsis">…</span>
        ) : (
          <button
            key={p}
            className={`page-btn ${p === page ? 'active' : ''}`}
            onClick={() => onChange(p)}
          >
            {p}
          </button>
        ),
      )}
      <button className="page-btn" disabled={page === totalPages} onClick={() => onChange(page + 1)}>
        Next <ChevronRight size={14} />
      </button>
    </nav>
  );
}

function JobDrawer({ job, onClose }: { job: Job | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {job && <JobDrawerInner job={job} onClose={onClose} />}
    </AnimatePresence>
  );
}

function JobDrawerInner({ job, onClose }: { job: Job; onClose: () => void }) {
  const posted = job.postedAt
    ? new Date(job.postedAt).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

  const experienceLabel =
    job.experienceLevel === 'Unknown'
      ? 'Not specified'
      : job.experienceYears
      ? `${job.experienceLevel} (${job.experienceYears} years)`
      : job.experienceLevel;

  const initials =
    job.company
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '·';

  const paragraphs = (job.description || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&[a-z]+;/gi, ' ')
    .split(/\n\s*\n|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <motion.div
      className="drawer-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
        <motion.aside
          className="drawer"
          initial={{ opacity: 0, scale: 0.94, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ type: 'spring', stiffness: 280, damping: 26 }}
          role="dialog"
          aria-label={`${job.title} at ${job.company}`}
          onClick={(e) => e.stopPropagation()}
        >
        <div className="drawer-head">
          <div className="drawer-logo" aria-hidden>{initials}</div>
          <div className="drawer-head-text">
            <h2>{job.title}</h2>
            <span className="company-line">
              <Building2 size={14} />
              {job.company}
            </span>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close preview">
            <X size={18} />
          </button>
        </div>

        <div className="drawer-meta">
          <span className={`job-source-tag ${job.isAI ? 'ai' : ''}`}>
            {job.isAI ? <Sparkles size={10} /> : <Radar size={10} />}
            {job.platform || job.source}
          </span>
          <span className="meta-chip">
            <MapPin size={11} />
            {job.location && job.location !== '—' ? job.location : job.country}
          </span>
          <span className="meta-chip exp">
            <Briefcase size={11} />
            {experienceLabel}
          </span>
          <span className="meta-chip">
            <Compass size={11} />
            {job.role}
          </span>
          {posted && (
            <span className="meta-chip">
              <Calendar size={11} />
              Posted {posted}
            </span>
          )}
        </div>

        <div className="drawer-body">
          <div className="drawer-section">
            <h4>Quick facts</h4>
            <div className="drawer-info-grid">
              <div className="drawer-info">
                <div className="label"><Building2 size={11} /> Company</div>
                <div className="value">{job.company}</div>
              </div>
              <div className="drawer-info">
                <div className="label"><Globe2 size={11} /> Country</div>
                <div className="value">{job.country}</div>
              </div>
              <div className="drawer-info">
                <div className="label"><MapPin size={11} /> Location</div>
                <div className="value">{job.location && job.location !== '—' ? job.location : '—'}</div>
              </div>
              <div className="drawer-info">
                <div className="label"><Briefcase size={11} /> Experience</div>
                <div className="value">{experienceLabel}</div>
              </div>
              <div className="drawer-info">
                <div className="label"><Compass size={11} /> Role family</div>
                <div className="value">{job.role}</div>
              </div>
              <div className="drawer-info">
                <div className="label"><Target size={11} /> Source</div>
                <div className="value">{job.platform || job.source || '—'}</div>
              </div>
            </div>
          </div>

          <div className="drawer-section">
            <h4>Full description</h4>
            <div className="drawer-desc">
              {paragraphs.length === 0 ? (
                <p style={{ color: 'var(--ink-mute)' }}>
                  No description provided for this listing.
                </p>
              ) : (
                paragraphs.map((p, i) => <p key={i}>{p}</p>)
              )}
            </div>
          </div>
        </div>

        <div className="drawer-foot">
          {job.applyUrl ? (
            <a
              className="drawer-apply"
              href={job.applyUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Apply on {job.platform || 'source'} <ExternalLink size={14} />
            </a>
          ) : (
            <span className="drawer-apply disabled">No apply link available</span>
          )}
        </div>
        </motion.aside>
      </motion.div>
  );
}

function MultiSelect<T extends string>({
  icon,
  options,
  selected,
  onChange,
  placeholder,
}: {
  icon: React.ReactNode;
  options: { value: T; label: string }[];
  selected: Set<T>;
  onChange: (next: Set<T>) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label =
    selected.size === 0
      ? placeholder
      : selected.size === 1
      ? options.find((o) => o.value === Array.from(selected)[0])?.label || placeholder
      : `${selected.size} selected`;

  function toggle(v: T) {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  }

  return (
    <div className="multi-wrap" ref={wrapRef}>
      <button
        type="button"
        className="multi-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="multi-trigger-icon">{icon}</span>
        <span className="multi-trigger-label">{label}</span>
        <ChevronDown size={14} className="multi-trigger-caret" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="multi-popover"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            role="listbox"
            aria-multiselectable
          >
            {selected.size > 0 && (
              <button
                type="button"
                className="multi-clear"
                onClick={() => onChange(new Set())}
              >
                Clear all
              </button>
            )}
            {options.map((opt) => {
              const checked = selected.has(opt.value);
              return (
                <button
                  type="button"
                  key={opt.value}
                  className={`multi-option ${checked ? 'checked' : ''}`}
                  onClick={() => toggle(opt.value)}
                  role="option"
                  aria-selected={checked}
                >
                  <span className="multi-check">
                    {checked && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
