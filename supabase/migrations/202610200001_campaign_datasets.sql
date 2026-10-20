-- Compressed snapshots avoid millions of individually indexed ASIN rows.
create table public.monitor_batches (
 id uuid primary key, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 kind text not null check(kind in ('accepted','active','controls')),
 expected_chunks integer not null check(expected_chunks between 1 and 500),
 compressed_bytes integer not null check(compressed_bytes between 1 and 150000000),
 created_at timestamptz not null default now()
);
create index monitor_batches_owner on public.monitor_batches(user_id,kind);
create table public.monitor_chunks (
 batch_id uuid not null references public.monitor_batches(id) on delete cascade,
 part integer not null check(part between 0 and 499), payload text not null check(length(payload)<=700000),
 primary key(batch_id,part)
);
create table public.monitor_heads (
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 kind text not null check(kind in ('accepted','active','controls')),
 batch_id uuid not null references public.monitor_batches(id),
 summary jsonb not null default '{}', updated_at timestamptz not null default now(),
 primary key(user_id,kind)
);
alter table public.monitor_batches enable row level security;
alter table public.monitor_chunks enable row level security;
alter table public.monitor_heads enable row level security;
create policy batches_owner on public.monitor_batches for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy chunks_owner on public.monitor_chunks for all to authenticated
 using(exists(select 1 from public.monitor_batches b where b.id=batch_id and b.user_id=(select auth.uid())))
 with check(exists(select 1 from public.monitor_batches b where b.id=batch_id and b.user_id=(select auth.uid())));
create policy heads_owner on public.monitor_heads for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant select,insert,update,delete on public.monitor_batches,public.monitor_chunks,public.monitor_heads to authenticated;
revoke all on public.monitor_batches,public.monitor_chunks,public.monitor_heads from anon;

-- Invoker rights preserve RLS. One owner-level lock serializes concurrent saves.
create function public.monitor_publish(p_batch uuid,p_expected uuid,p_summary jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare b public.monitor_batches; current_id uuid; n integer; low integer; high integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into b from public.monitor_batches where id=p_batch and user_id=auth.uid();
 if b.id is null then raise exception 'Upload not found'; end if;
 select batch_id into current_id from public.monitor_heads where user_id=auth.uid() and kind=b.kind;
 if current_id is distinct from p_expected then raise exception 'Data changed in another tab. Reload before saving.'; end if;
 select count(*),min(part),max(part) into n,low,high from public.monitor_chunks where batch_id=p_batch;
 if n<>b.expected_chunks or low<>0 or high<>n-1 then raise exception 'Incomplete upload'; end if;
 insert into public.monitor_heads(user_id,kind,batch_id,summary) values(auth.uid(),b.kind,p_batch,p_summary)
 on conflict(user_id,kind) do update set batch_id=excluded.batch_id,summary=excluded.summary,updated_at=now();
 -- Keep only current snapshot and recent in-flight uploads. No weekly full-history growth.
 delete from public.monitor_batches x where x.user_id=auth.uid() and x.kind=b.kind and x.id<>p_batch
 and (x.id=current_id or x.created_at<now()-interval '1 day')
 and not exists(select 1 from public.monitor_heads h where h.batch_id=x.id);
end $$;
revoke all on function public.monitor_publish(uuid,uuid,jsonb) from public;
grant execute on function public.monitor_publish(uuid,uuid,jsonb) to authenticated;
