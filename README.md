# Menga Dress

Il mio armadio digitale: fotografo i capi, l'AI li cataloga e ogni giorno mi propone cosa indossare in base a umore, occasione e meteo.

Menga Dress è una web app installabile sul telefono, pubblicata con GitHub Pages. Non serve nessun server: armadio, outfit e profilo restano salvati sul telefono.

## Sezioni

- **Armadio**: aggiungi un capo con una foto; Claude riconosce categoria, colori, materiale, stagioni, formalità e stili. Puoi correggere tutto e filtrare per categoria.
- **Outfit**: scegli umore e occasione, l'app legge il meteo e propone 3 outfit fatti con i tuoi capi. Metti 👍/👎 e segna cosa indossi: i voti migliorano le proposte successive.
- **Profilo**: misure, taglie (anche per marca), stili e colori preferiti, budget.
- **Impostazioni** (icona in alto): chiave API, modello, backup e ripristino.

## Primo avvio

1. **Attiva GitHub Pages** (una volta sola): nel repository vai su *Settings → Pages* e in *Source* scegli **GitHub Actions**. Ogni modifica su `main` viene pubblicata in automatico su `https://mizral86.github.io/Dress/`.
2. **Installa l'app**: apri quell'indirizzo con Chrome sul telefono Android, menu ⋮ → **Installa app** (o *Aggiungi a schermata Home*).
3. **Chiave API**: crea una chiave su [console.anthropic.com](https://console.anthropic.com/settings/keys) (serve una piccola ricarica di credito) e incollala nelle impostazioni dell'app. Resta salvata solo sul telefono.

## Costi

Con Claude Sonnet 5.5, circa mezzo centesimo per catalogare un capo e circa un centesimo per ogni proposta di outfit. Hosting e meteo ([Open-Meteo](https://open-meteo.com)) sono gratuiti.

## Note tecniche

- HTML, CSS e JavaScript senza passaggi di build, nella cartella `web/`.
- Dati in IndexedDB sul dispositivo; il backup scarica un file JSON con anche le foto.
- Le chiamate a Claude partono direttamente dal browser con la chiave dell'utente. Va bene per uso personale; se l'app verrà pubblicata per altri servirà un piccolo server che custodisca la chiave.

Per provarla in locale: `cd web && python3 -m http.server 8000` e apri `http://localhost:8000`.
