// Collegamento al progetto Supabase gratuito (login e sincronizzazione).
// Si trovano su supabase.com → il tuo progetto → Project Settings → API:
//   - "Project URL"            → SUPABASE_URL
//   - chiave "anon" / "publishable" → SUPABASE_ANON_KEY
// La chiave anon è pubblica per natura: i dati sono protetti dalle regole (RLS) di supabase/setup.sql.
// Lasciati vuoti, l'app funziona come prima, solo sul telefono e senza login.
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

// Catalogo dei manichini pubblici (quelli pubblicati dall'amministratore, visibili a tutti).
// Lasciati vuoti si usa il progetto Supabase qui sopra o quello collegato nelle Impostazioni.
export const CATALOGO_URL = '';
export const CATALOGO_KEY = '';
