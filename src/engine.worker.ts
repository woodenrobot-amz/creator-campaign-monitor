import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { parseCampaignCsv, readReport } from './importer';
import { buildMatches, emptyControls, isAvailable, type Accepted, type Active, type Campaign, type Controls, type Filters, type Kind, type Overview } from './model';
let accepted: Accepted|undefined, active: Active|undefined;
let controls = emptyControls(); let previous: Map<string,boolean>|undefined;
let watched = new Set<string>(), ids = new Set<string>();
let pending: {kind:Kind; value:Accepted|Active; previous?:[string,boolean][]}|undefined;
const today = () => new Date().toLocaleDateString('en-CA',{timeZone:'America/New_York'});
function overview(filters:Filters):Overview {
  const all=buildMatches(active?.campaigns??[],ids,watched,controls,previous,today());
  const q=filters.query.toLowerCase();
  const selected=all.filter(m=>(!filters.manual||m.manual)&&(!filters.available||isAvailable(m.campaign as Campaign,today()))&&(!filters.hideReviewed||!m.reviewed)&&(!filters.newOnly||m.event!=='existing')&&(!q||`${m.campaign.name} ${m.campaign.brand} ${m.asins.join(' ')}`.toLowerCase().includes(q)));
  return { accepted:accepted?.info, active:active?.info, watched:watched.size, acceptedIds:ids.size, matches:selected.slice(filters.page*50,(filters.page+1)*50), total:selected.length, available:all.filter(m=>isAvailable(m.campaign as Campaign,today())).length, newCount:all.filter(m=>m.event!=='existing').length };
}
self.onmessage=async({data})=>{
  const {request,action}=data;
  const reply=(result:unknown)=>self.postMessage({request,result});
  try {
    if(action==='load'){
      const value=JSON.parse(strFromU8(gunzipSync(data.bytes)));
      if(data.kind==='accepted'){accepted=value;watched=new Set(accepted!.asins);ids=new Set(accepted!.ids);}
      if(data.kind==='active'){active=value;previous=value.previous?new Map(value.previous):undefined;}
      if(data.kind==='controls')controls=value;
      reply(true);
    } else if(action==='import'){
      const kind=data.kind as 'accepted'|'active'; const campaigns=new Map<string,Campaign>();
      const nextIds=new Set(ids), nextAsins=new Set(watched);
      let rows=0, duplicates=0; const seen=new Set<string>();
      const files=await readReport(data.file,(text)=>{
        rows+=parseCampaignCsv(text,kind,c=>{
          if(seen.has(c.id)){duplicates++;if(kind==='active'){const old=campaigns.get(c.id)!;if(JSON.stringify({...old,asins:[]})!==JSON.stringify({...c,asins:[]}))throw new Error(`Conflicting duplicate campaign ${c.id}. Download a fresh report.`);old.asins=[...new Set([...old.asins,...c.asins])];}else{for(const a of c.asins)nextAsins.add(a);}return;}seen.add(c.id);
          if(kind==='accepted'){nextIds.add(c.id);for(const a of c.asins)nextAsins.add(a);}else campaigns.set(c.id,c);
        });
      },message=>self.postMessage({request,progress:message}));
      self.postMessage({request,progress:'Compressing validated report…'});
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await data.file.arrayBuffer()))).map(b=>b.toString(16).padStart(2,'0')).join('');
      if((kind==='accepted'?accepted:active)?.info.hash===hash)throw new Error('This exact file has already been imported.');
      const info={filename:data.file.name,importedAt:new Date().toISOString(),files,rows,campaigns:seen.size,hash};
      const prior=active?.campaigns.map(c=>[c.id,isAvailable(c,today())] as [string,boolean]);
      const value=kind==='accepted'?{ids:[...nextIds].sort(),asins:[...nextAsins].sort(),info}:{campaigns:[...campaigns.values()],info,previous:prior};
      pending={kind,value,previous:prior};
      const bytes=gzipSync(strToU8(JSON.stringify(value)),{level:6});
      self.postMessage({request,result:{bytes,info,duplicates}},[bytes.buffer]);
    }else if(action==='commit'){
      if(!pending)throw new Error('No validated import.');
      if(pending.kind==='accepted'){accepted=pending.value as Accepted;watched=new Set(accepted.asins);ids=new Set(accepted.ids);}else {active=pending.value as Active;previous=pending.previous?new Map(pending.previous):undefined;}
      pending=undefined;reply(overview(data.filters));
    }else if(action==='discard'){pending=undefined;reply(true);}
    else if(action==='query'){controls=data.controls;reply(overview(data.filters));}
    else if(action==='controls'){controls=data.controls;reply(gzipSync(strToU8(JSON.stringify(controls))));}
    else if(action==='getControls')reply(controls);
  }catch(e){self.postMessage({request,error:e instanceof Error?e.message:String(e)});}
};
