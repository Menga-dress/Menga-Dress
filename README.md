# Menga Dress

Il mio armadio digitale: fotografo i capi e ogni giorno l'app mi propone cosa indossare in base a umore, occasione e meteo.

È una web app gratuita, installabile sul telefono e pubblicata con GitHub Pages. Non servono account, chiavi o abbonamenti: tutto funziona sul telefono e i dati restano lì.

## Sezioni

- **Armadio**: aggiungi un capo con una foto (scatto o galleria). L'app riconosce da sola i colori; tu scegli categoria e tipo con un tocco, e formalità, stagioni e stili si compilano di conseguenza. Tutto si può correggere.
- **Outfit**: scegli umore e occasione, l'app legge il meteo e propone 3 outfit fatti con i tuoi capi, con la spiegazione dell'abbinamento. Se ti manca qualcosa (o l'armadio è vuoto) propone lei il capo da prendere, con un link per cercarlo online nella tua taglia. "Altre proposte" ne genera di nuove; 👍/👎 e "Lo indosso oggi" migliorano le proposte successive.
- **Profilo**: misure, taglie (anche per marca), stili e colori preferiti o da evitare, budget.
- **Impostazioni** (icona in alto): backup e ripristino.

## Come funzionano i consigli

Ogni proposta mostra il manichino Menga Dress con i colori dei capi proposti, disegnato all'istante sul telefono (nessuna rete, nessuna attesa).

Lo stylist è in `web/js/stylist.js` e usa regole di stile, senza servizi esterni:

- formalità adatta all'occasione (es. lavoro 3–4, sport 1);
- stili e colori che seguono l'umore e il profilo;
- armonia dei colori: neutri con al massimo un colore protagonista, mai due fantasie insieme;
- capi adatti alla stagione e al meteo, giacca se fa fresco o piove;
- capi indossati negli ultimi giorni lasciati a riposo, abbinamenti votati 👍 favoriti e 👎 evitati.

I colori della foto sono riconosciuti in `web/js/colors.js` analizzando la parte centrale dell'immagine.

## Primo avvio

1. GitHub Pages pubblica `web/` a ogni modifica su `main`: `https://mizral86.github.io/Menga-Dress/`.
2. Sul telefono apri l'indirizzo con Chrome. Poi **⋮ → Installa app**.

## Note tecniche

- HTML, CSS e JavaScript senza passaggi di build, nella cartella `web/`.
- Dati in IndexedDB sul dispositivo; il backup scarica un file JSON con anche le foto.
- Meteo da [Open-Meteo](https://open-meteo.com), gratuito e senza chiave.

Per provarla in locale: `cd web && python3 -m http.server 8000` e apri `http://localhost:8000`.
