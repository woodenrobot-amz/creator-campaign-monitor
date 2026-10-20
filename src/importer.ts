import Papa from 'papaparse';
import { Unzip, UnzipInflate } from 'fflate';
import { extractAsins, type Campaign } from './model';
export const MAX_EXPANDED = 750 * 1024 * 1024;
const required = ['ASIN List','Campaign Id','Campaign Name','Brand Name','Campaign Start Date','Campaign End Date','Commission Rate','Campaign Budget','Budget Remaining'];
function number(value: string, name: string): number {
  if (!value?.trim()) throw new Error(`Missing ${name}.`);
  const n = Number(value.replace(/%$/, ''));
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${name}: ${value}`);
  return n;
}
function date(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0,10) !== value) throw new Error(`Invalid campaign date: ${value}`);
  return value;
}
export function parseCampaignCsv(text: string, kind: 'accepted'|'active', consume: (c: Campaign)=>void): number {
  let checked = false; let rows = 0;
  Papa.parse<Record<string,string>>(text.replace(/^\uFEFF/, ''), {
    header: true, skipEmptyLines: 'greedy', transformHeader: h => h.trim(),
    step: result => {
      if (result.errors.length) throw new Error(`CSV row ${rows+2}: ${result.errors[0].message}`);
      if (!checked) {
        const fields = result.meta.fields ?? [];
        for (const key of [...required, ...(kind === 'active' ? ['Available Slot','Total Slot'] : [])]) if (!fields.includes(key)) throw new Error(`Missing column: ${key}. Check the upload area.`);
        // Accepted exports do not contain slot columns; reject swapping the two reports.
        if (kind === 'accepted' && fields.includes('Available Slot')) throw new Error('This is an active-campaign report. Use All Active Campaigns.');
        checked = true;
      }
      const r = result.data;
      const asins = extractAsins(r['ASIN List'] ?? '');
      if (!r['Campaign Id']?.startsWith('amzn1.campaign.') || !asins.length) throw new Error(`CSV row ${rows+2}: missing campaign ID or ASINs.`);
      const start = date(r['Campaign Start Date']); const end = date(r['Campaign End Date']);
      const rate = number(r['Commission Rate'], 'commission rate');
      if (start > end || rate > 100) throw new Error(`CSV row ${rows+2}: invalid dates or commission rate.`);
      const slots = kind === 'active' ? number(r['Available Slot'], 'available slots') : 0;
      if (!Number.isInteger(slots)) throw new Error('Available slots must be a whole number.');
      consume({ id:r['Campaign Id'], name:r['Campaign Name'], brand:r['Brand Name'], asins, start, end, rate, budget:number(r['Budget Remaining'],'budget remaining'), slots });
      rows++;
    }
  });
  if (!rows) throw new Error('The CSV has no campaign rows.');
  return rows;
}
export async function readReport(file: File, consume: (text:string, name:string)=>void, progress: (message:string)=>void): Promise<number> {
  if (file.size > 250*1024*1024) throw new Error('Maximum upload size is 250 MB.');
  if (file.name.toLowerCase().endsWith('.csv')) { consume(await file.text(),file.name); return 1; }
  if (!file.name.toLowerCase().endsWith('.zip')) throw new Error('Choose an Amazon ZIP or CSV report.');
  let count=0, total=0, failure: Error|undefined;
  const unzip = new Unzip(entry => {
    if (entry.name.startsWith('__MACOSX/') || !entry.name.toLowerCase().endsWith('.csv')) return;
    count++; if(count>30) throw new Error('Too many CSV files in the ZIP.');
    if (entry.originalSize && entry.originalSize > MAX_EXPANDED) throw new Error('Expanded report exceeds 750 MB.');
    const decoder=new TextDecoder('utf-8',{fatal:true}); const parts:string[]=[];
    entry.ondata=(error, bytes, final)=>{
      if(error){failure=error;return;}
      total+=bytes.length;
      if(total>MAX_EXPANDED){failure=new Error('Expanded report exceeds 750 MB.');throw failure;}
      try { parts.push(decoder.decode(bytes,{stream:!final})); if(final){ progress(`Reading ${entry.name}…`);consume(parts.join(''),entry.name);parts.length=0; } } catch(e){failure=e as Error; throw e;}
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  const reader=file.stream().getReader();
  try {
    while(true){const {done,value}=await reader.read();if(done)break;unzip.push(value);if(failure)throw failure;}
    unzip.push(new Uint8Array(),true);
  } finally { reader.releaseLock(); }
  if(failure)throw failure;
  if(!count)throw new Error('No CSV files were found in this ZIP.');
  return count;
}
