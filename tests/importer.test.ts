import {describe,it,expect} from 'vitest';
import {zipSync,strToU8} from 'fflate';
import {parseCampaignCsv,readReport} from '../src/importer';
import {buildMatches,emptyControls,isAvailable,manualAsins,type Campaign} from '../src/model';
const headers='ASIN List,Campaign Id,Campaign Name,Brand Name,Campaign Start Date,Campaign End Date,Commission Rate,Campaign Budget,Budget Remaining';
const row='"[B012345678, B087654321]",amzn1.campaign.A,"Saw, 6 inch",Tools,2026-01-01,2027-01-01,10.00%,1000,900';
const csv=headers+'\r\n'+row;
const c:Campaign={id:'amzn1.campaign.A',name:'Saw',brand:'Tools',asins:['B012345678','B087654321'],start:'2026-01-01',end:'2027-01-01',rate:10,budget:100,slots:1};
describe('Amazon report imports',()=>{
 it('parses quoted ASIN arrays, BOM and commas in titles',()=>{const rows:Campaign[]=[];expect(parseCampaignCsv('\uFEFF'+csv,'accepted',r=>rows.push(r))).toBe(1);expect(rows[0].asins).toEqual(c.asins);expect(rows[0].name).toBe('Saw, 6 inch');});
 it('rejects swapped reports and missing slot fields',()=>{expect(()=>parseCampaignCsv(csv,'active',()=>{})).toThrow('Available Slot');expect(()=>parseCampaignCsv(headers+',Available Slot,Total Slot\n'+row+',1,800','accepted',()=>{})).toThrow('active-campaign report');});
 it('rejects malformed, empty, and invalid numeric rows',()=>{expect(()=>parseCampaignCsv(csv.replace('10.00%','bad'),'accepted',()=>{})).toThrow();expect(()=>parseCampaignCsv(headers,'accepted',()=>{})).toThrow();expect(()=>parseCampaignCsv(csv+'"','accepted',()=>{})).toThrow();});
 it('opens all CSVs in nested ZIPs and ignores non-CSV files',async()=>{const zipped=zipSync({'one.csv':strToU8(csv),'nested/two.csv':strToU8(csv),'note.txt':strToU8('ignore')});const file=new File([zipped as BlobPart],'report.zip');let count=0;expect(await readReport(file,text=>{count+=parseCampaignCsv(text,'accepted',()=>{});},()=>{})).toBe(2);expect(count).toBe(2);});
 it('rejects corrupt ZIPs and archives without CSVs',async()=>{await expect(readReport(new File(['bad'],'bad.zip'),()=>{},()=>{})).rejects.toThrow();await expect(readReport(new File([zipSync({'note.txt':strToU8('x')}) as BlobPart],'empty.zip'),()=>{},()=>{})).rejects.toThrow();});
});
describe('watchlist matching',()=>{
 it('excludes accepted campaigns by ID but detects another campaign on the same ASIN',()=>{const matches=buildMatches([c,{...c,id:'amzn1.campaign.B'}],new Set([c.id]),new Set(c.asins),emptyControls(),undefined,'2026-10-20');expect(matches).toHaveLength(1);expect(matches[0].campaign.id).toBe('amzn1.campaign.B');});
 it('matches manual watches without an accepted import',()=>{expect(buildMatches([c],new Set(),new Set(),{...emptyControls(),watches:[{asin:c.asins[0],note:'',paused:false}]},undefined,'2026-10-20')[0].manual).toBe(true);});
 it('keeps pauses and exclusions effective against imported ASINs',()=>{expect(buildMatches([c],new Set(),new Set(c.asins),{...emptyControls(),excluded:[c.asins[1]],watches:[{asin:c.asins[0],note:'',paused:true}]},undefined,'2026-10-20')).toHaveLength(0);});
 it('distinguishes baseline, new, and reopened campaigns',()=>{const run=(prior?:Map<string,boolean>)=>buildMatches([c],new Set(),new Set(c.asins),emptyControls(),prior,'2026-10-20')[0].event;expect(run()).toBe('existing');expect(run(new Map())).toBe('new');expect(run(new Map([[c.id,false]]))).toBe('reopened');expect(run(new Map([[c.id,true]]))).toBe('existing');});
 it('does not call full, exhausted, future or expired campaigns available',()=>{for(const patch of [{slots:0},{budget:0},{start:'2026-11-01'},{end:'2026-10-19'}])expect(isAvailable({...c,...patch},'2026-10-20')).toBe(false);});
 it('accepts lists and product URLs but rejects short or unrelated URLs',()=>{expect(manualAsins('b012345678, https://www.amazon.com/dp/B087654321?tag=x')).toEqual(c.asins);expect(()=>manualAsins('https://amzn.to/abc')).toThrow();expect(()=>manualAsins('https://example.com/dp/B012345678')).toThrow();});
});
