# Menga Dress

Il mio armadio digitale: fotografo i capi e ogni giorno l'app mi propone cosa indossare in base a umore, occasione e meteo.

È una web app gratuita, installabile sul telefono e pubblicata con GitHub Pages. Non servono chiavi o abbonamenti: tutto funziona sul telefono. L'account è facoltativo e serve per avere l'armadio sincronizzato su più dispositivi (Supabase, piano gratuito).

## Sezioni

- **Armadio**: aggiungi un capo con una foto (scatto o galleria). L'app riconosce da sola i colori; tu scegli categoria e tipo con un tocco, e formalità, stagioni e stili si compilano di conseguenza. Tutto si può correggere.
- **Outfit**: scegli umore e occasione, l'app legge il meteo e propone 3 outfit fatti con i tuoi capi, con la spiegazione dell'abbinamento. Se ti manca qualcosa (o l'armadio è vuoto) propone lei il capo da prendere, con un link per cercarlo online nella tua taglia. "Altre proposte" ne genera di nuove; 👍/👎 e "Lo indosso oggi" migliorano le proposte successive.
- **Profilo**: misure, taglie (anche per marca), stili e colori preferiti o da evitare, budget.
- **Impostazioni** (icona in alto): account, backup e ripristino, tema.

## Come funzionano i consigli

Ogni proposta mostra un manichino fotografico (creato con ChatGPT in colori pieni: giacca rossa, maglia verde, pantaloni blu, scarpe gialle) che l'app ricolora all'istante con i colori dei capi proposti, mantenendo pieghe e luci. Per aggiungerne uno: `python3 tools/manichino/prepara.py <immagine> web/img/manichino/<nome>` e farlo scegliere in `choosePhoto` dentro `web/js/look.js`. Se l'immagine non si carica resta il manichino disegnato in SVG. Tema chiaro (Impostazioni → Donna · chiaro): manichini `donna-*` (opzioni `--testa=122 --rosso-stretto --senza-riflesso`, `--rosso-maglia` per il top senza giacca).

Lo stylist è in `web/js/stylist.js` e usa regole di stile, senza servizi esterni:

- formalità adatta all'occasione (es. lavoro 3–4, sport 1);
- stili e colori che seguono l'umore e il profilo;
- armonia dei colori: neutri con al massimo un colore protagonista, mai due fantasie insieme;
- capi adatti alla stagione e al meteo, giacca se fa fresco o piove;
- capi indossati negli ultimi giorni lasciati a riposo, abbinamenti votati 👍 favoriti e 👎 evitati.

I colori della foto sono riconosciuti in `web/js/colors.js` analizzando la parte centrale dell'immagine.

## Login e sincronizzazione (Supabase gratuito)

Una volta sola:

1. Crea un account gratuito su [supabase.com](https://supabase.com) e poi **New project** (piano Free, scegli una regione europea e una password per il database).
2. Nel progetto apri **SQL Editor → New query**, incolla tutto il file [`supabase/setup.sql`](supabase/setup.sql) e premi **Run**. Crea la tabella dei dati e lo spazio privato per le foto, visibili solo a te.
3. **Authentication → URL Configuration**: in *Site URL* metti `https://menga-dress.github.io/Menga-Dress/` (serve per i link di conferma email e di cambio password).
4. **Project Settings → API** (o *Data API* / *API Keys*): copia **Project URL** e la chiave **anon** (o *publishable*).
5. Nell'app: ⚙️ → **Account** → incolla i due valori → **Collega**, poi **Registrati**. Arriva un'email di conferma: aprila e poi fai **Accedi**. In alternativa i due valori si possono scrivere in `web/js/config.js`, così valgono su ogni dispositivo senza incollarli.

Come funziona: i dati restano prima di tutto sul telefono (IndexedDB) e l'app li copia nel cloud all'accesso, qualche secondo dopo ogni modifica e quando la riapri. Per ogni capo vince la versione modificata più di recente; le foto vanno nello storage privato `foto`. Senza accesso l'app funziona come prima.

Limiti del piano gratuito: 500 MB di database e 1 GB di foto (migliaia di capi). Se il progetto resta **7 giorni senza uso** Supabase lo mette in pausa: si riattiva con un clic dalla dashboard, nel frattempo l'app funziona offline.

## Primo avvio

1. GitHub Pages pubblica `web/` a ogni modifica su `main`: `https://mizral86.github.io/Menga-Dress/`.
2. Sul telefono apri l'indirizzo con Chrome. Poi **⋮ → Installa app**.

## Note tecniche

- HTML, CSS e JavaScript senza passaggi di build, nella cartella `web/`.
- Dati in IndexedDB sul dispositivo; il backup scarica un file JSON con anche le foto.
- Account e sincronizzazione in `web/js/sync.js` (libreria `@supabase/supabase-js` caricata dal CDN jsDelivr solo se il progetto è collegato).
- Meteo da [Open-Meteo](https://open-meteo.com), gratuito e senza chiave.

Per provarla in locale: `cd web && python3 -m http.server 8000` e apri `http://localhost:8000`.
