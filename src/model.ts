export type Kind = 'accepted' | 'active' | 'controls';
export interface Campaign { id: string; name: string; brand: string; asins: string[]; start: string; end: string; rate: number; budget: number; slots: number }
export interface ImportInfo { filename: string; importedAt: string; files: number; rows: number; campaigns: number; hash: string }
export interface Accepted { ids: string[]; asins: string[]; info: ImportInfo }
export interface Active { campaigns: Campaign[]; info: ImportInfo }
export interface Watch { asin: string; note: string; paused: boolean }
export interface Controls { watches: Watch[]; excluded: string[]; reviewed: string[] }
export const emptyControls = (): Controls => ({ watches: [], excluded: [], reviewed: [] });
export interface Match { campaign: Omit<Campaign, 'asins'>; asins: string[]; manual: boolean; event: 'new' | 'reopened' | 'existing'; reviewed: boolean }
export interface Filters { query: string; manual: boolean; available: boolean; newOnly: boolean; hideReviewed: boolean; page: number }
export interface Overview { accepted?: ImportInfo; active?: ImportInfo; watched: number; acceptedIds: number; matches: Match[]; total: number; available: number; newCount: number; storedBytes?: number }
export function extractAsins(value: string): string[] {
  return [...new Set(value.toUpperCase().match(/\b[A-Z0-9]{10}\b/g) ?? [])];
}
export function manualAsins(value: string): string[] {
  const tokens = value.trim().split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length) throw new Error('Enter an ASIN or Amazon product URL.');
  return [...new Set(tokens.map(token => {
    if (/^[A-Z0-9]{10}$/i.test(token)) return token.toUpperCase();
    let url: URL;
    try { url = new URL(token); } catch { throw new Error(`Invalid ASIN or URL: ${token}`); }
    if (!/(^|\.)amazon\.(com|ca|co\.uk)$/.test(url.hostname)) throw new Error('Use a full Amazon product URL or a 10-character ASIN.');
    const match = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i.exec(url.pathname);
    if (!match) throw new Error('Use the full product URL containing /dp/ASIN, rather than a short link.');
    return match[1].toUpperCase();
  }))];
}
export function isAvailable(c: Campaign, today: string): boolean { return c.slots > 0 && c.budget > 0 && c.start <= today && c.end >= today; }
export function buildMatches(active: Campaign[], accepted: Set<string>, watched: Set<string>, controls: Controls, previous?: Map<string, boolean>, today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })): Match[] {
  const manual = new Set(controls.watches.filter(w => !w.paused).map(w => w.asin));
  const excluded = new Set([...controls.excluded, ...controls.watches.filter(w => w.paused).map(w => w.asin)]);
  const reviewed = new Set(controls.reviewed);
  const result: Match[] = [];
  for (const c of active) {
    if (accepted.has(c.id) || c.end < today) continue;
    const asins = c.asins.filter(a => !excluded.has(a) && (watched.has(a) || manual.has(a)));
    if (!asins.length) continue;
    const { asins: _all, ...campaign } = c;
    result.push({campaign, asins, manual: asins.some(a => manual.has(a)), reviewed: reviewed.has(c.id), event: previous && !previous.has(c.id) ? 'new' : previous?.get(c.id) === false && isAvailable(c, today) ? 'reopened' : 'existing'});
  }
  return result.sort((a,b) => Number(isAvailable(b.campaign as Campaign,today))-Number(isAvailable(a.campaign as Campaign,today)) || b.campaign.rate-a.campaign.rate || a.campaign.id.localeCompare(b.campaign.id));
}
