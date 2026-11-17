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

-- 4) Manichini pubblici: li vedono tutti gli utenti dell'app, li pubblica solo l'amministratore.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;
drop policy if exists "admins: vedo solo me" on public.admins;
create policy "admins: vedo solo me" on public.admins
  for select to authenticated using (user_id = auth.uid());

create table if not exists public.manichini (
  id       text        primary key,
  data     jsonb       not null default '{}'::jsonb,
  modified timestamptz not null default now()
);
alter table public.manichini enable row level security;
drop policy if exists "manichini: tutti leggono" on public.manichini;
create policy "manichini: tutti leggono" on public.manichini
  for select to anon, authenticated using (true);
drop policy if exists "manichini: scrive l'amministratore" on public.manichini;
create policy "manichini: scrive l'amministratore" on public.manichini
  for all to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- Immagini dei manichini: cartella pubblica (si leggono senza accesso), scrive solo l'amministratore.
insert into storage.buckets (id, name, public)
values ('manichini', 'manichini', true)
on conflict (id) do nothing;
drop policy if exists "manichini file: scrive l'amministratore" on storage.objects;
create policy "manichini file: scrive l'amministratore" on storage.objects
  for all to authenticated
  using (bucket_id = 'manichini' and exists (select 1 from public.admins a where a.user_id = auth.uid()))
  with check (bucket_id = 'manichini' and exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- 5) Diventa amministratore: togli i due trattini all'inizio della riga qui sotto,
--    scrivi la TUA email al posto di quella d'esempio e premi Run (basta una volta).
-- insert into public.admins select id from auth.users where email = 'la-tua-email@esempio.it' on conflict do nothing;
