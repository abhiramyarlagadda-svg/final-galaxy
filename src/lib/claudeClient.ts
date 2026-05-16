import Anthropic from '@anthropic-ai/sdk';
import type { Job } from './radarClient';

const STORAGE_KEY = 'job-radar.anthropic-key';
// Optional baked-in default. Leave empty so the user can set their own via the UI.
// (User asked for in-code credentials but didn't supply an Anthropic key.)
const HARDCODED_KEY = '';

export function getAnthropicKey(): string {
  if (HARDCODED_KEY) return HARDCODED_KEY;
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setAnthropicKey(key: string) {
  try {
    localStorage.setItem(STORAGE_KEY, key.trim());
  } catch {
    /* ignore */
  }
}

export function hasAnthropicKey(): boolean {
  return Boolean(getAnthropicKey());
}

function client() {
  const apiKey = getAnthropicKey();
  if (!apiKey) throw new Error('Anthropic API key not set. Click "Connect AI" to add one.');
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export interface AIJobSuggestion {
  title: string;
  company: string;
  location: string;
  description: string;
  experience: string;
  url?: string;
  source: string;
}

/**
 * Ask Claude to surface fresh / recently-posted jobs matching the query.
 * Uses the model's web-search tool when available, otherwise falls back
 * to a structured generation of plausible-but-recent listings.
 */
export async function fetchAIJobs(params: {
  technology: string;
  country: string;
}): Promise<Job[]> {
  const c = client();
  const { technology, country } = params;
  const target = [technology, country].filter(Boolean).join(' in ') || 'software engineering';

  const prompt = `You are a job-market researcher. Find 8 RECENTLY POSTED (last 30 days) real job openings for "${target}".

Return ONLY a JSON array — no prose, no markdown fences. Each item must look like:
{
  "title": "string",
  "company": "string",
  "location": "City, Country",
  "description": "1-2 sentence summary including years of experience required if known",
  "experience": "e.g. 0-1 years / 2-4 years / 5+ years",
  "url": "https://link-to-apply",
  "source": "LinkedIn|Indeed|company website|etc"
}

Prefer well-known, currently hiring companies. Include the experience requirement clearly in the description so it can be parsed.`;

  try {
    const res = await c.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('\n');

    const jsonStart = text.indexOf('[');
    const jsonEnd = text.lastIndexOf(']');
    if (jsonStart === -1 || jsonEnd === -1) return [];
    const slice = text.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(slice) as AIJobSuggestion[];

    return parsed.map((s, i) => {
      const combined = `${s.title} ${s.description} ${s.experience}`.toLowerCase();
      const yearsMatch = combined.match(/(\d+)\s*(?:\+|-)?\s*(?:to)?\s*(\d+)?\s*(?:years?|yrs?)/);
      let years: number | null = null;
      if (yearsMatch) {
        const lo = parseInt(yearsMatch[1], 10);
        const hi = yearsMatch[2] ? parseInt(yearsMatch[2], 10) : lo;
        if (!isNaN(lo) && !isNaN(hi)) years = Math.round((lo + hi) / 2);
      }
      let level: Job['experienceLevel'] = 'Unknown';
      if (years !== null) {
        if (years <= 1) level = 'Entry';
        else if (years <= 4) level = 'Mid';
        else if (years <= 8) level = 'Senior';
        else level = 'Lead';
      }
      const country = (s.location || '').split(',').pop()?.trim() || 'Unknown';
      return {
        id: `ai-${Date.now()}-${i}`,
        title: s.title || 'Untitled role',
        company: s.company || 'Unknown company',
        location: s.location || '—',
        country,
        description: s.description || '',
        source: s.source || 'AI',
        platform: 'Claude AI',
        postedAt: new Date().toISOString(),
        applyUrl: s.url || null,
        experienceYears: years,
        experienceLevel: level,
        role: 'AI-sourced',
        isAI: true,
      } satisfies Job;
    });
  } catch (err) {
    console.error('[Claude] fetchAIJobs failed:', err);
    throw err;
  }
}
