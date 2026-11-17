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

Il tipo di capo (felpa, jeans, blazer…) è riconosciuto sul telefono in `web/js/riconosci.js` con il modello gratuito MobileCLIP S0 (`web/modello/`, circa 23 MB scaricati solo la prima volta, poi in cache) e [ONNX Runtime Web](https://onnxruntime.ai) in `web/vendor/ort/`. Nessuna chiave, nessun server. L'app poi collega il capo a quelli dei manichini (`MANNEQUIN` in `web/js/catalog.js`, uomo e donna) e segnala con ⚠ i capi che i manichini non hanno, indicando il più simile. Per cambiare i tipi riconosciuti: modifica `tools/modello/etichette.json` e fai push su un ramo; il workflow *Modello riconoscimento capi* rigenera `web/modello/`.

## Login e sincronizzazione (Supabase gratuito)

Una volta sola:

1. Crea un account gratuito su [supabase.com](https://supabase.com) e poi **New project** (piano Free, scegli una regione europea e una password per il database).
2. Nel progetto apri **SQL Editor → New query**, incolla tutto il file [`supabase/setup.sql`](supabase/setup.sql) e premi **Run**. Crea la tabella dei dati e lo spazio privato per le foto, visibili solo a te.
3. **Authentication → URL Configuration**: in *Site URL* metti `https://menga-dress.github.io/Menga-Dress/` (serve per i link di conferma email e di cambio password).
4. **Project Settings → API** (o *Data API* / *API Keys*): copia **Project URL** e la chiave **publishable** (`sb_publishable_…`, oppure la vecchia **anon** `eyJ…`; mai la *secret*). Se l'URL copiato finisce con `/rest/v1/` va bene lo stesso.
5. Nell'app: ⚙️ → **Account** → incolla i due valori → **Collega**, poi **Registrati**. Arriva un'email di conferma: aprila e poi fai **Accedi**. In alternativa i due valori si possono scrivere in `web/js/config.js`, così valgono su ogni dispositivo senza incollarli.

### Accesso con Google (facoltativo, gratis)

1. Vai su [console.cloud.google.com](https://console.cloud.google.com), crea un progetto (es. "Menga Dress").
2. **API e servizi → Schermata consenso OAuth** (o *Google Auth Platform*): tipo **Esterno**, nome app "Menga Dress", la tua email come supporto e contatto. Salva. In *Utenti di test* aggiungi la tua email (oppure premi **Pubblica app**).
3. **API e servizi → Credenziali → Crea credenziali → ID client OAuth**: tipo **Applicazione web**.
   - *Origini JavaScript autorizzate*: `https://menga-dress.github.io`
   - *URI di reindirizzamento autorizzati*: `https://<il-tuo-progetto>.supabase.co/auth/v1/callback` (lo trovi già scritto in Supabase al passo 4, con il pulsante copia).
   Premi **Crea** e copia **ID client** e **Client secret**.
4. In Supabase: **Authentication → Sign In / Providers → Google** → attiva, incolla ID client e Client secret → **Save**.
5. Controlla che in **Authentication → URL Configuration** il *Site URL* sia `https://menga-dress.github.io/Menga-Dress/`.

Nell'app compare **Accedi con Google** nella schermata di accesso. Il Client secret resta solo in Supabase, mai nell'app.

Come funziona: i dati restano prima di tutto sul telefono (IndexedDB) e l'app li copia nel cloud all'accesso, qualche secondo dopo ogni modifica e quando la riapri. Per ogni capo vince la versione modificata più di recente; le foto vanno nello storage privato `foto`. Senza accesso l'app funziona come prima.

Limiti del piano gratuito: 500 MB di database e 1 GB di foto (migliaia di capi). Se il progetto resta **7 giorni senza uso** Supabase lo mette in pausa: si riattiva con un clic dalla dashboard, nel frattempo l'app funziona offline.

## Primo avvio

1. GitHub Pages pubblica `web/` a ogni modifica su `main`: `https://mizral86.github.io/Menga-Dress/`.
2. Sul telefono apri l'indirizzo con Chrome. Poi **⋮ → Installa app**.

## Note tecniche

- HTML, CSS e JavaScript senza passaggi di build, nella cartella `web/`.
- Dati in IndexedDB sul dispositivo; il backup scarica un file JSON con anche le foto.
- Account e sincronizzazione in `web/js/sync.js` (libreria `@supabase/supabase-js` caricata dal CDN jsDelivr solo se il progetto è collegato).
- Sfondo delle foto tolto sul telefono con U²-Net piccolo (u2netp, licenza Apache 2.0, `web/modello/sfondo.onnx`, 4,6 MB) in `web/js/sfondo.js`; la foto con lo sfondo si può rimettere finché il capo non è salvato.
- L'app impara dalle correzioni: per ogni capo salvato tiene l'"impronta" della foto (in IndexedDB, chiave `impronte`, solo sul telefono). Una foto nuova molto simile a un capo già salvato prende il suo tipo (`web/js/riconosci.js`).
- Manichini creati da te (⚙️ › Manichini, o "Carica il manichino" dal capo che non ce l'ha): l'immagine a colori pieni (giacca rossa, maglia verde, pantaloni blu, scarpe gialle) viene preparata sul telefono da `web/js/manichini.js` (stessa logica di `tools/manichino/prepara.py`), salvata in IndexedDB (chiave `manichini`) e inclusa nel backup.
- Diario (`renderDiary` in `web/js/app.js`): settimana col meteo dei prossimi giorni (`getForecast`) per pianificare gli outfit (`planned: 'AAAA-MM-GG'` nello store `outfits`), calendario del mese con gli outfit indossati e statistiche (mai indossati, più usati, dimenticati, categorie, colori, cosa manca con link di ricerca).
- Nuovo manichino: "Crea con ChatGPT" apre chatgpt.com col testo già scritto; "Crea con Gemini" lo condivide con l'app Gemini (o lo copia e apre Gemini).
- Manichini per tutti: l'amministratore (utente presente nella tabella `admins` di `supabase/setup.sql`) pubblica i suoi manichini con "Pubblica per tutti"; finiscono nella tabella `manichini` e nella cartella pubblica `manichini` di Supabase. Ogni app li scarica (`syncShared` in `web/js/manichini.js`) dal progetto in `CATALOGO_URL`/`CATALOGO_KEY` di `web/js/config.js` (o da quello collegato) e li tiene anche offline. I manichini personali vincono su quelli per tutti, che vincono su quelli dell'app.
- Meteo da [Open-Meteo](https://open-meteo.com), gratuito e senza chiave.

Per provarla in locale: `cd web && python3 -m http.server 8000` e apri `http://localhost:8000`.
