-- Statistiche degli utenti per l'amministratore (Impostazioni → Statistiche dell'app).
-- Incolla tutto nel SQL Editor di Supabase e premi Run (basta una volta).
-- Chi non è in public.admins riceve un errore: gli altri utenti non vedono niente.
create or replace function public.admin_stats()
returns table (
  email text, iscritto timestamptz, ultimo_accesso timestamptz,
  capi bigint, outfit bigint, indossati bigint, ultima_modifica timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admins a where a.user_id = auth.uid()) then
    raise exception 'solo per l''amministratore';
  end if;
  return query
  select u.email::text, u.created_at, u.last_sign_in_at,
    count(*) filter (where r.kind = 'items' and not r.deleted),
    count(*) filter (where r.kind = 'outfits' and not r.deleted),
    count(*) filter (where r.kind = 'outfits' and not r.deleted and (r.data->>'worn')::boolean is true),
    max(r.modified)
  from auth.users u
  left join public.records r on r.user_id = u.id
  group by u.id
  order by max(r.modified) desc nulls last;
end;
$$;
revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;
