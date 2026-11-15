// Account (email e password) e sincronizzazione dell'armadio con Supabase, piano gratuito.
// L'app resta "prima di tutto sul telefono": i dati vivono in IndexedDB e, se hai fatto
// l'accesso, vengono copiati nel tuo spazio Supabase e scaricati sugli altri dispositivi.
// Regola: per ogni capo/outfit vince la versione modificata più di recente.
import * as db from './db.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
const CONF_KEY = 'menga-supabase';
const BUCKET = 'foto';
const STORES = ['items', 'outfits'];

export function getConfig() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY, fixed: true };
  try {
    const c = JSON.parse(localStorage.getItem(CONF_KEY) || 'null');
    if (c?.url && c?.key) return c;
  } catch (e) { /* niente */ }
  return null;
}

// Accetta anche indirizzi incollati con percorsi (/rest/v1/…), senza https o con spazi:
// tiene solo https://<progetto>.supabase.co
export function normalizeUrl(raw) {
  let t = (raw || '').trim().replace(/\s+/g, '');
  if (t && !/^[a-z]+:\/\//i.test(t)) t = 'https://' + t;
  try {
    const u = new URL(t);
    const host = u.hostname.toLowerCase();
    if (!/^[a-z0-9-]+\.supabase\.(co|in)$/.test(host)) return null;
    return 'https://' + host;
  } catch (e) { return null; }
}

export function setConfig(url, key) {
  url = normalizeUrl(url);
  key = (key || '').trim().replace(/\s+/g, '');
  if (!url) throw new Error('Indirizzo del progetto non valido (es. https://abcd.supabase.co)');
  if (/^sb_secret_/i.test(key)) throw new Error('Questa è la chiave segreta: usa quella "publishable" (sb_publishable_…) o "anon".');
  if (!/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key) && !/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error('Chiave non valida: copia la chiave "publishable" (sb_publishable_…) o "anon" (eyJ…).');
  }
  localStorage.setItem(CONF_KEY, JSON.stringify({ url, key }));
  clientPromise = null;
}

export function clearConfig() {
  localStorage.removeItem(CONF_KEY);
  clientPromise = null;
}

export const isConfigured = () => !!getConfig();

let clientPromise = null;
export function client() {
  if (globalThis.__mengaSupabase) return Promise.resolve(globalThis.__mengaSupabase); // per i test
  const cfg = getConfig();
  if (!cfg) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import(LIB).then(({ createClient }) => createClient(cfg.url, cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    })).catch((e) => { clientPromise = null; throw e; });
  }
  return clientPromise;
}

// ---------- account ----------

const ERRORS = [
  [/invalid login credentials/i, 'Email o password sbagliate.'],
  [/email not confirmed/i, 'Devi prima confermare l\'email: apri il link che ti è arrivato.'],
  [/already registered|already been registered/i, 'Esiste già un account con questa email: fai Accedi.'],
  [/password should be at least/i, 'La password deve avere almeno 6 caratteri.'],
  [/provider is not enabled|unsupported provider/i, 'L\'accesso con Google non è ancora attivo nel progetto Supabase (Authentication → Providers → Google).'],
  [/rate limit|too many/i, 'Troppi tentativi, riprova tra qualche minuto.'],
  [/failed to fetch|network|load failed/i, 'Nessuna connessione a Supabase. Controlla internet (o il progetto è in pausa).'],
  [/unable to validate email|invalid format/i, 'Email non valida.'],
];
export function friendlyError(e) {
  const msg = e?.message || String(e);
  for (const [re, it] of ERRORS) if (re.test(msg)) return it;
  return msg;
}

export async function currentUser() {
  const sb = await client().catch(() => null);
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data?.session?.user || null;
}

export async function signIn(email, password) {
  const sb = await client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

// Ritorna { user, needsConfirm }: se Supabase chiede la conferma via email, la sessione arriva dopo.
export async function signUp(email, password) {
  const sb = await client();
  const { data, error } = await sb.auth.signUp({
    email, password, options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
  return { user: data.user, needsConfirm: !data.session };
}

// Accesso con Google: porta alla pagina di Google e poi torna nell'app già dentro.
export async function signInWithGoogle() {
  const sb = await client();
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw error;
}

export async function resetPassword(email) {
  const sb = await client();
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) throw error;
}

export async function updatePassword(password) {
  const sb = await client();
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  const sb = await client();
  await sb.auth.signOut();
  localStorage.removeItem('menga-last-sync');
}

export async function onAuthChange(fn) {
  const sb = await client().catch(() => null);
  if (sb) sb.auth.onAuthStateChange((event, session) => fn(event, session?.user || null));
}

// ---------- sincronizzazione ----------

const modOf = (r) => r?._mod || r?.updatedAt || r?.createdAt || r?.date || '1970-01-01T00:00:00.000Z';
const imgVersion = (it) => it.updatedAt || it.createdAt || it.id;
// a è più recente di b? (una data mancante conta come "mai")
const later = (a, b) => (a ? new Date(a).getTime() : -1) > (b ? new Date(b).getTime() : -1);

let running = null;
export function lastSync() { return localStorage.getItem('menga-last-sync'); }

// Sincronizza tutto. Ritorna quante cose sono arrivate dal cloud (per ridisegnare la pagina).
export function syncNow() {
  if (!running) running = doSync().finally(() => { running = null; });
  return running;
}

async function doSync() {
  const sb = await client();
  const user = await currentUser();
  if (!sb || !user) return 0;
  const uid = user.id;

  const { data: remote, error } = await sb.from('records').select('kind,id,data,modified,deleted');
  if (error) throw error;
  const remoteMap = new Map(remote.map((r) => [r.kind + ':' + r.id, r]));

  const tomb = (await db.getKV('tombstones')) || {};
  const toUpsert = [];
  let pulled = 0;

  for (const store of STORES) {
    const local = await db.getAll(store);
    const localMap = new Map(local.map((r) => [r.id, r]));
    const ids = new Set([...localMap.keys(), ...remote.filter((r) => r.kind === store).map((r) => r.id)]);
    for (const k of Object.keys(tomb)) if (k.startsWith(store + ':')) ids.add(k.slice(store.length + 1));

    for (const id of ids) {
      const key = store + ':' + id;
      const L = localMap.get(id);
      const T = tomb[key];
      const R = remoteMap.get(key);
      const localMod = L ? modOf(L) : T;

      if (!R || later(localMod, R.modified)) {
        if (L) {
          const { image, ...data } = L;
          if (store === 'items') {
            data.hasImage = !!image;
            data.imgV = imgVersion(L);
            if (image && (!R || R.data?.imgV !== data.imgV)) {
              const up = await sb.storage.from(BUCKET).upload(`${uid}/${id}.jpg`, image, { upsert: true, contentType: image.type || 'image/jpeg' });
              if (up.error) throw up.error;
            }
          }
          toUpsert.push({ kind: store, id, data, modified: localMod, deleted: false });
        } else if (T && R && !R.deleted) {
          toUpsert.push({ kind: store, id, data: {}, modified: T, deleted: true });
          if (store === 'items') await sb.storage.from(BUCKET).remove([`${uid}/${id}.jpg`]);
        }
        continue;
      }
      if (!later(R.modified, localMod)) continue; // uguali: niente da fare

      // Il cloud è più recente.
      if (R.deleted) {
        if (L) { await db.rawRemove(store, id); pulled++; }
        continue;
      }
      const rec = { ...R.data, _mod: R.modified };
      if (store === 'items') {
        const { hasImage, imgV } = rec;
        delete rec.hasImage; delete rec.imgV;
        let image = null;
        if (L?.image && imgVersion(L) === imgV) image = L.image;
        else if (hasImage) {
          const dl = await sb.storage.from(BUCKET).download(`${uid}/${id}.jpg`);
          if (!dl.error) image = dl.data;
        }
        rec.image = image;
      }
      await db.rawPut(store, rec);
      delete tomb[key];
      pulled++;
    }
  }

  // Profilo
  const P = await db.getKV('profile');
  const pMod = (await db.getKV('profile_mod')) || (P ? '1970-01-01T00:00:00.000Z' : null);
  const RP = remoteMap.get('profile:me');
  if (P && (!RP || later(pMod, RP.modified))) {
    toUpsert.push({ kind: 'profile', id: 'me', data: P, modified: pMod, deleted: false });
  } else if (RP && !RP.deleted && (!pMod || later(RP.modified, pMod))) {
    await db.rawSetKV('profile', RP.data);
    await db.rawSetKV('profile_mod', RP.modified);
    pulled++;
  }

  for (let i = 0; i < toUpsert.length; i += 200) {
    const chunk = toUpsert.slice(i, i + 200).map((r) => ({ ...r, user_id: uid }));
    const { error: e2 } = await sb.from('records').upsert(chunk, { onConflict: 'user_id,kind,id' });
    if (e2) throw e2;
  }
  // Le lapidi già portate nel cloud (o mai esistite lì) non servono più.
  await db.rawSetKV('tombstones', {});
  localStorage.setItem('menga-last-sync', new Date().toISOString());
  return pulled;
}
