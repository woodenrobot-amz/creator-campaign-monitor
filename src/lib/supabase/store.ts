import {publicSupabase} from '../../config';
import {createClient} from '@supabase/supabase-js';
import type {Kind} from '../../model';
const url=import.meta.env.VITE_SUPABASE_URL || publicSupabase.url, key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || publicSupabase.publishableKey;
export const client=url&&key?createClient(url,key):null;
export interface Head {kind:Kind;batch_id:string;summary:Record<string,unknown>;updated_at:string}
const db=()=>{if(!client)throw new Error('Supabase configuration is required.');return client;};
export async function heads():Promise<Head[]>{const {data,error}=await db().from('monitor_heads').select('*');if(error)throw error;return data;}
export async function load(head:Head):Promise<Uint8Array>{
 const {data,error}=await db().from('monitor_chunks').select('part,payload').eq('batch_id',head.batch_id).order('part');if(error)throw error;
 const {data:batch,error:batchError}=await db().from('monitor_batches').select('expected_chunks,compressed_bytes').eq('id',head.batch_id).single();if(batchError)throw batchError;
 if(data.length!==batch.expected_chunks)throw new Error('Saved dataset is incomplete.');
 const chunks=data.map((row,i)=>{if(row.part!==i)throw new Error('Saved dataset is incomplete.');return Uint8Array.from(atob(row.payload),c=>c.charCodeAt(0));});
 const bytes=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 if(bytes.length!==batch.compressed_bytes)throw new Error('Saved dataset size does not match.');return bytes;
}
export async function save(kind:Kind,bytes:Uint8Array,expected:string|null,summary:Record<string,unknown>,progress:(s:string)=>void):Promise<Head>{
 const id=crypto.randomUUID(),size=480000,n=Math.ceil(bytes.length/size);
 if(n>500||bytes.length>150000000)throw new Error('Compressed dataset exceeds the supported size.');
 const {error:startError}=await db().from('monitor_batches').insert({id,kind,expected_chunks:n,compressed_bytes:bytes.length});if(startError)throw startError;
 for(let part=0;part<n;part++){
  progress(`Saving ${kind} dataset: ${Math.round(part/n*100)}%`);
  const chunk=bytes.subarray(part*size,(part+1)*size);let binary='';for(let i=0;i<chunk.length;i+=8192)binary+=String.fromCharCode(...chunk.subarray(i,i+8192));
  const {error}=await db().from('monitor_chunks').insert({batch_id:id,part,payload:btoa(binary)});if(error)throw error;
 }
 // Do not delete staging data on an ambiguous network failure: publication might have succeeded.
 const {error}=await db().rpc('monitor_publish',{p_batch:id,p_expected:expected,p_summary:{...summary,compressedBytes:bytes.length}});if(error)throw error;
 return {kind,batch_id:id,summary:{...summary,compressedBytes:bytes.length},updated_at:new Date().toISOString()};
}
