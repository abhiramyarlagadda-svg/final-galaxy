import { createClient } from '@supabase/supabase-js';

// Hardcoded read-only credentials (per user request — no env files).
export const RADAR_URL = 'https://owsbrhyzkprqgasesbqa.supabase.co';
export const RADAR_KEY = 'sb_publishable_kSjtU-a5LrlYS8Z7ON46nA_ISXf8AU8';

export const radarSupabase = createClient(RADAR_URL, RADAR_KEY, {
  auth: { persistSession: false },
});

export interface RawJob {
  id: string;
  title?: string | null;
  job_title?: string | null;
  company?: string | null;
  company_name?: string | null;
  location?: string | null;
  description?: string | null;
  job_description?: string | null;
  source?: string | null;
  platform?: string | null;
  posted_at?: string | null;
  created_at?: string | null;
  url?: string | null;
  apply_url?: string | null;
  applyUrl?: string | null;
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  country: string;
  description: string;
  source: string;
  platform: string;
  postedAt: string | null;
  applyUrl: string | null;
  experienceYears: number | null;
  experienceLevel: ExperienceLevel;
  role: string;
  isAI?: boolean;
}

export type ExperienceLevel = 'Internship' | 'Entry' | 'Mid' | 'Senior' | 'Lead' | 'Unknown';

const COUNTRY_HINTS: Record<string, string> = {
  india: 'India',
  bharat: 'India',
  bengaluru: 'India',
  bangalore: 'India',
  hyderabad: 'India',
  pune: 'India',
  mumbai: 'India',
  delhi: 'India',
  chennai: 'India',
  noida: 'India',
  gurgaon: 'India',
  gurugram: 'India',
  kolkata: 'India',
  ahmedabad: 'India',
  'united states': 'United States',
  usa: 'United States',
  'u.s.': 'United States',
  ' us ': 'United States',
  america: 'United States',
  california: 'United States',
  'new york': 'United States',
  texas: 'United States',
  washington: 'United States',
  seattle: 'United States',
  'san francisco': 'United States',
  boston: 'United States',
  chicago: 'United States',
  austin: 'United States',
  'united kingdom': 'United Kingdom',
  uk: 'United Kingdom',
  england: 'United Kingdom',
  london: 'United Kingdom',
  manchester: 'United Kingdom',
  scotland: 'United Kingdom',
  canada: 'Canada',
  toronto: 'Canada',
  vancouver: 'Canada',
  montreal: 'Canada',
  ontario: 'Canada',
  germany: 'Germany',
  berlin: 'Germany',
  munich: 'Germany',
  france: 'France',
  paris: 'France',
  spain: 'Spain',
  madrid: 'Spain',
  barcelona: 'Spain',
  italy: 'Italy',
  rome: 'Italy',
  milan: 'Italy',
  netherlands: 'Netherlands',
  amsterdam: 'Netherlands',
  australia: 'Australia',
  sydney: 'Australia',
  melbourne: 'Australia',
  singapore: 'Singapore',
  ireland: 'Ireland',
  dublin: 'Ireland',
  switzerland: 'Switzerland',
  zurich: 'Switzerland',
  japan: 'Japan',
  tokyo: 'Japan',
  uae: 'United Arab Emirates',
  dubai: 'United Arab Emirates',
  'abu dhabi': 'United Arab Emirates',
  remote: 'Remote',
  worldwide: 'Remote',
  anywhere: 'Remote',
};

// Strict allow-list — only these values are valid in the country filter.
// Anything that doesn't match maps to "Other".
export const KNOWN_COUNTRIES = [
  'India',
  'United States',
  'United Kingdom',
  'Canada',
  'Germany',
  'France',
  'Spain',
  'Italy',
  'Netherlands',
  'Australia',
  'Singapore',
  'Ireland',
  'Switzerland',
  'Japan',
  'United Arab Emirates',
  'Remote',
] as const;

const KNOWN_SET = new Set<string>(KNOWN_COUNTRIES);

export function detectCountry(location: string | null | undefined): string {
  if (!location) return 'Other';
  const raw = ' ' + location.toLowerCase() + ' ';

  // direct longest-match first
  const keys = Object.keys(COUNTRY_HINTS).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (raw.includes(k)) {
      const c = COUNTRY_HINTS[k];
      return KNOWN_SET.has(c) ? c : 'Other';
    }
  }

  // If the last comma-token is itself a known country, accept it; otherwise "Other".
  const last = location.split(',').map((x) => x.trim()).filter(Boolean).pop();
  if (last && KNOWN_SET.has(last)) return last;
  return 'Other';
}

function parseExperienceYears(text: string): number | null {
  if (!text) return null;
  const t = text.toLowerCase();

  const patterns = [
    /(\d{1,2})\s*[-–to]+\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/i,
    /(\d{1,2})\s*\+\s*(?:years?|yrs?)/i,
    /minimum\s*(?:of\s*)?(\d{1,2})\s*(?:years?|yrs?)/i,
    /at\s*least\s*(\d{1,2})\s*(?:years?|yrs?)/i,
    /(\d{1,2})\s*(?:years?|yrs?)\s*(?:of\s*)?(?:experience|exp)/i,
    /(\d{1,2})\s*(?:years?|yrs?)/i,
  ];

  for (const p of patterns) {
    const m = t.match(p);
    if (m) {
      if (m[2]) {
        const lo = parseInt(m[1], 10);
        const hi = parseInt(m[2], 10);
        if (!isNaN(lo) && !isNaN(hi)) return Math.round((lo + hi) / 2);
      }
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n <= 30) return n;
    }
  }
  return null;
}

export function classifyExperience(title: string, description: string): {
  level: ExperienceLevel;
  years: number | null;
} {
  const combined = `${title} ${description}`.toLowerCase();
  const years = parseExperienceYears(combined);

  if (/\b(intern|internship|trainee|industrial training)\b/.test(combined)) {
    return { level: 'Internship', years };
  }
  if (/\b(principal|staff|architect|distinguished)\b/.test(combined)) {
    return { level: 'Lead', years: years ?? 10 };
  }
  if (/\b(lead|head of|director|manager)\b/.test(combined) && !/\b(team lead position open to entry)\b/.test(combined)) {
    return { level: 'Lead', years: years ?? 8 };
  }
  if (/\b(senior|sr\.?|sde[\s-]?(?:3|iii))\b/.test(combined)) {
    return { level: 'Senior', years: years ?? 5 };
  }
  if (/\b(junior|jr\.?|entry[\s-]?level|fresher|graduate|new grad|sde[\s-]?(?:1|i))\b/.test(combined)) {
    return { level: 'Entry', years: years ?? 1 };
  }
  if (years !== null) {
    if (years <= 1) return { level: 'Entry', years };
    if (years <= 4) return { level: 'Mid', years };
    if (years <= 8) return { level: 'Senior', years };
    return { level: 'Lead', years };
  }
  if (/\b(mid[\s-]?level|sde[\s-]?(?:2|ii))\b/.test(combined)) {
    return { level: 'Mid', years: 3 };
  }
  return { level: 'Unknown', years: null };
}

function classifyRole(title: string): string {
  const t = title.toLowerCase();
  if (/\b(data\s*scien|ml\s*engineer|machine\s*learning|ai\s*engineer)\b/.test(t)) return 'Data / AI';
  if (/\b(data\s*analyst|business\s*intelligence|bi\s*analyst)\b/.test(t)) return 'Data / AI';
  if (/\b(devops|sre|site\s*reliability|platform\s*engineer|cloud\s*engineer)\b/.test(t)) return 'DevOps / Cloud';
  if (/\b(frontend|front[\s-]?end|react|angular|vue|ui\s*engineer)\b/.test(t)) return 'Frontend';
  if (/\b(backend|back[\s-]?end|api|server)\b/.test(t)) return 'Backend';
  if (/\b(full[\s-]?stack)\b/.test(t)) return 'Full-stack';
  if (/\b(mobile|android|ios|flutter|react\s*native)\b/.test(t)) return 'Mobile';
  if (/\b(qa|tester|automation|sdet)\b/.test(t)) return 'QA / Testing';
  if (/\b(security|infosec|cyber|pentest)\b/.test(t)) return 'Security';
  if (/\b(product\s*manager|pm\b|product\s*owner)\b/.test(t)) return 'Product';
  if (/\b(designer|ux|ui\b)\b/.test(t)) return 'Design';
  if (/\b(software|developer|engineer|programmer|sde)\b/.test(t)) return 'Software Engineering';
  return 'Other';
}

export function normalizeJob(raw: RawJob): Job {
  const title = (raw.title || raw.job_title || 'Untitled role').trim();
  const company = (raw.company || raw.company_name || 'Unknown company').trim();
  const description = (raw.description || raw.job_description || '').trim();
  const location = (raw.location || '').trim();
  const country = detectCountry(location);
  const { level, years } = classifyExperience(title, description);
  return {
    id: raw.id,
    title,
    company,
    location: location || '—',
    country,
    description,
    source: raw.source || 'Standard',
    platform: raw.platform || 'Unknown',
    postedAt: raw.posted_at || raw.created_at || null,
    applyUrl: raw.url || raw.apply_url || raw.applyUrl || null,
    experienceYears: years,
    experienceLevel: level,
    role: classifyRole(title),
  };
}

export interface FetchOptions {
  technology?: string;
  country?: string;
  onProgress?: (loaded: number) => void;
}

// Supabase caps a single REST response at ~1000 rows, so we range-paginate
// until we've drained the table. No hard upper limit — every row is pulled.
const PAGE = 1000;
const HARD_CAP = 100_000; // safety net so a runaway loop can't hang the browser

export async function fetchJobs(options: FetchOptions = {}): Promise<Job[]> {
  const { technology = '', country = '', onProgress } = options;

  const buildQuery = (orderByPostedAt: boolean) => {
    let q = radarSupabase.from('jobs').select('*');
    if (technology.trim()) {
      const t = technology.trim();
      q = q.or(
        `title.ilike.%${t}%,description.ilike.%${t}%,job_title.ilike.%${t}%,job_description.ilike.%${t}%`,
      );
    }
    if (country.trim() && country !== 'All' && country !== 'Other') {
      q = q.ilike('location', `%${country.trim()}%`);
    }
    if (orderByPostedAt) {
      q = q.order('posted_at', { ascending: false, nullsFirst: false });
    }
    return q;
  };

  const drain = async (orderByPostedAt: boolean): Promise<RawJob[]> => {
    const all: RawJob[] = [];
    let from = 0;
    while (from < HARD_CAP) {
      const { data, error } = await buildQuery(orderByPostedAt).range(from, from + PAGE - 1);
      if (error) throw error;
      const rows = (data as RawJob[]) || [];
      all.push(...rows);
      onProgress?.(all.length);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    return all;
  };

  try {
    const rows = await drain(true);
    return rows.map(normalizeJob);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Fall back if posted_at column is absent
    if (/posted_at/.test(msg)) {
      const rows = await drain(false);
      return rows.map(normalizeJob);
    }
    throw err;
  }
}
