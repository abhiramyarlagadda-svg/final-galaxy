import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Briefcase,
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Compass,
  ExternalLink,
  Globe2,
  Key,
  MapPin,
  Radar,
  Search,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { fetchJobs, type ExperienceLevel, type Job } from './lib/radarClient';
import {
  fetchAIJobs,
  getAnthropicKey,
  hasAnthropicKey,
  setAnthropicKey,
} from './lib/claudeClient';

const PAGE_SIZE = 20;

const EXPERIENCE_OPTIONS: { value: ExperienceLevel | 'All'; label: string }[] = [
  { value: 'All', label: 'All levels' },
  { value: 'Internship', label: 'Internship' },
  { value: 'Entry', label: 'Entry (0-1 yrs)' },
  { value: 'Mid', label: 'Mid (2-4 yrs)' },
  { value: 'Senior', label: 'Senior (5-8 yrs)' },
  { value: 'Lead', label: 'Lead / Principal (9+)' },
];

interface Toast {
  message: string;
  kind: 'success' | 'error' | 'info';
}

export default function App() {
  const [technology, setTechnology] = useState('');
  const [country, setCountry] = useState<string>('All');
  const [experience, setExperience] = useState<ExperienceLevel | 'All'>('All');
  const [role, setRole] = useState<string>('All');

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<Toast | null>(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');

  /* ------------------------------------------------------------------ */
  /*                              Loaders                               */
  /* ------------------------------------------------------------------ */
  async function load(opts?: { tech?: string; country?: string }) {
    setLoading(true);
    try {
      const fetched = await fetchJobs({
        technology: opts?.tech ?? technology,
        country: opts?.country && opts.country !== 'All' ? opts.country : '',
      });
      setJobs(fetched);
      setPage(1);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setToast({ kind: 'error', message: `Could not load jobs: ${msg}` });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // initial fetch only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const set = new Set<string>();
    jobs.forEach((j) => j.country && set.add(j.country));
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [jobs]);

  const roles = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach((j) => j.role && set.add(j.role));
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [jobs]);

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      if (country !== 'All' && j.country !== country) return false;
      if (experience !== 'All' && j.experienceLevel !== experience) return false;
      if (role !== 'All' && j.role !== role) return false;
      return true;
    });
  }, [jobs, country, experience, role]);

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
              <strong>{jobs.length}</strong> jobs loaded
            </span>
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
            <label>Experience</label>
            <div className="input-wrap">
              <Briefcase size={16} />
              <select
                className="select"
                value={experience}
                onChange={(e) => setExperience(e.target.value as ExperienceLevel | 'All')}
              >
                {EXPERIENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
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
              {loading ? 'Scanning…' : 'Search'}
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
            {experience !== 'All' && ` · ${experience}`}
          </h3>
          <div className="sort-group">
            Page <strong style={{ color: 'var(--green-700)', margin: '0 4px' }}>{safePage}</strong> of {totalPages}
          </div>
        </div>

        {loading ? (
          <div className="grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton-card" />
            ))}
          </div>
        ) : pageItems.length === 0 ? (
          <EmptyState onReset={() => { setTechnology(''); setCountry('All'); setExperience('All'); setRole('All'); load({ tech: '', country: '' }); }} />
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
                  <JobCard key={job.id} job={job} />
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

function JobCard({ job }: { job: Job }) {
  const posted = job.postedAt
    ? new Date(job.postedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  const experienceLabel =
    job.experienceLevel === 'Unknown'
      ? 'Experience N/A'
      : job.experienceYears
      ? `${job.experienceLevel} · ${job.experienceYears}y`
      : job.experienceLevel;

  return (
    <motion.article
      layout
      className="job-card"
      variants={{
        hidden: { opacity: 0, y: 16 },
        show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.2, 0.7, 0.2, 1] } },
      }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
    >
      <div className="job-card-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h4 className="job-title" title={job.title}>{job.title}</h4>
          <p className="job-company">
            <Building2 size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: -1 }} />
            {job.company}
          </p>
        </div>
        <span className={`job-source-tag ${job.isAI ? 'ai' : ''}`}>
          {job.isAI ? <Sparkles size={10} /> : <Radar size={10} />}
          {job.platform || job.source}
        </span>
      </div>

      <div className="job-meta">
        <span className="meta-chip">
          <MapPin size={11} />
          {job.country}{job.location && job.location !== job.country && job.location !== '—' && ` · ${job.location.split(',')[0]}`}
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

      {job.description && (
        <p className="job-desc">{cleanDescription(job.description)}</p>
      )}

      <div className="job-foot">
        <span className="job-date">
          <Calendar size={11} />
          {posted ?? 'Date n/a'}
        </span>
        {job.applyUrl ? (
          <a className="apply-link" href={job.applyUrl} target="_blank" rel="noopener noreferrer">
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
