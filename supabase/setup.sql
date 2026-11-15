-- Menga Dress: preparazione del progetto Supabase (piano gratuito).
-- Da incollare una sola volta in Supabase → SQL Editor → New query → Run.

-- 1) Tabella unica per capi, outfit e profilo di ogni utente.
create table if not exists public.records (
  user_id  uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind     text        not null check (kind in ('items', 'outfits', 'profile')),
  id       text        not null,
  data     jsonb       not null default '{}'::jsonb,
  modified timestamptz not null default now(),
  deleted  boolean     not null default false,
  primary key (user_id, kind, id)
);

-- 2) Ognuno vede e modifica solo i propri dati.
alter table public.records enable row level security;

drop policy if exists "records: solo i miei" on public.records;
create policy "records: solo i miei" on public.records
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 3) Spazio privato per le foto dei capi: cartella <id utente>/<id capo>.jpg
insert into storage.buckets (id, name, public)
values ('foto', 'foto', false)
on conflict (id) do nothing;

drop policy if exists "foto: solo le mie" on storage.objects;
create policy "foto: solo le mie" on storage.objects
  for all to authenticated
  using (bucket_id = 'foto' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'foto' and (storage.foldername(name))[1] = auth.uid()::text);
