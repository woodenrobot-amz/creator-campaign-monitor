import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,it,expect} from 'vitest';
let db:PGlite;
const owner='00000000-0000-0000-0000-000000000001';
const other='00000000-0000-0000-0000-000000000002';
const first='10000000-0000-0000-0000-000000000001';
const second='10000000-0000-0000-0000-000000000002';
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role authenticated; create role anon; create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${owner}'),('${other}'); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
 await db.exec(readFileSync(new URL('../supabase/migrations/202610200001_campaign_datasets.sql',import.meta.url),'utf8'));
 await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';`);
},20000);
afterAll(async()=>{await db?.close();});
it('keeps incomplete and conflicting imports from replacing a saved snapshot',async()=>{
 await db.query("insert into monitor_batches(id,kind,expected_chunks,compressed_bytes) values($1,'accepted',1,1)",[first]);
 await expect(db.query('select monitor_publish($1,null,$2)',[first,{}])).rejects.toThrow('Incomplete');
 await db.query("insert into monitor_chunks(batch_id,part,payload) values($1,0,'eA==')",[first]);
 await db.query('select monitor_publish($1,null,$2)',[first,{campaigns:1}]);
 await db.query("insert into monitor_batches(id,kind,expected_chunks,compressed_bytes) values($1,'accepted',1,1)",[second]);
 await db.query("insert into monitor_chunks(batch_id,part,payload) values($1,0,'eQ==')",[second]);
 await expect(db.query('select monitor_publish($1,null,$2)',[second,{}])).rejects.toThrow('another tab');
 const before=await db.query<{batch_id:string}>('select batch_id from monitor_heads');expect(before.rows[0].batch_id).toBe(first);
 await db.query('select monitor_publish($1,$2,$3)',[second,first,{}]);
 const after=await db.query<{batch_id:string}>('select batch_id from monitor_heads');expect(after.rows[0].batch_id).toBe(second);
 const count=await db.query<{n:number}>('select count(*)::int n from monitor_batches');expect(count.rows[0].n).toBe(1);
});
it('isolates datasets by authenticated owner and blocks anonymous reads',async()=>{
 await db.exec(`set request.jwt.claim.sub='${other}';`);
 for(const table of ['monitor_heads','monitor_batches','monitor_chunks'])expect((await db.query(`select * from ${table}`)).rows).toHaveLength(0);
 await expect(db.query("insert into monitor_batches(id,user_id,kind,expected_chunks,compressed_bytes) values(gen_random_uuid(),$1,'active',1,1)",[owner])).rejects.toThrow();
 await db.exec('reset role; set role anon;');await expect(db.query('select * from monitor_heads')).rejects.toThrow('permission denied');
});
