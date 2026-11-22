import * as db from './db.js';
import { getWeather, getForecast, savedCity, setCity, forgetCity } from './weather.js';
import { detectColors } from './colors.js';
import { suggestOutfits, ideaName, DRESS_CODES, readInvite } from './stylist.js';
import { lookView, garmentView, previewPhoto, forgetPhoto, posesFor } from './look.js';
import { prepareMannequin, loadCustom, saveCustom, removeCustom, syncShared, isAdmin, publishShared, unpublishShared, makeDefinitive, fixedCount } from './manichini.js';
import { analyzeGarment, isModelCached, rememberGarment, forgetGarment, learnFromWardrobe } from './riconosci.js';
import { removeBackground } from './sfondo.js';
import * as sync from './sync.js';
import {
  CATEGORIES, SEASONS, STYLES, PATTERNS, MOODS, OCCASIONS, FORMALITY, SUBTYPES, PALETTE, describeItem,
  mannequinMatch, currentGender, CUSTOM, ZONE_CATEGORIES, zoneOfCategory,
} from './catalog.js';

const APP_VERSION = '65'; // da aumentare a ogni modifica, si vede nelle Impostazioni
const view = document.getElementById('view');
const titleEl = document.getElementById('view-title');

// Logo Menga: gruccia geometrica con la stellina, nel colore d'accento del tema.
const HANGER_SVG = '<svg viewBox="80 100 352 270" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"><path d="M226 158a30 30 0 1 1 30 30v26"/><path d="M256 214L104 330q-16 14 6 20h292q22-6 6-20z"/></g><path fill="currentColor" d="M256 248q4 30 30 34q-26 4-30 34q-4-30-30-34q26-4 30-34z"/></svg>';
function brandLogo() {
  const el = h('div', { class: 'brand-logo', role: 'img', 'aria-label': 'Menga Smart Wardrobe' });
  el.innerHTML = HANGER_SVG + '<b>MENGA</b><small>Smart Wardrobe</small>';
  return el;
}

// ---------- sezioni dei capi (stile maschile, femminile o entrambi) ----------

// Ogni capo ha il suo armadio (it.per): uomo, donna o entrambi. Il profilo sceglie solo quello dei capi nuovi.
let profileGender = '';
const SECTION_LABELS = { uomo: 'Stile maschile', donna: 'Stile femminile', entrambi: 'Entrambi' };
const fixedSection = () => (profileGender === 'uomo' || profileGender === 'donna' ? profileGender : '');
const ARMADI = { uomo: 'Uomo', donna: 'Donna', entrambi: 'Entrambi' };
const itemSection = (it) => it.per || fixedSection() || 'entrambi';
const inSection = (it) => { const s = itemSection(it); return s === 'entrambi' || s === currentGender(); };
async function loadProfileGender() {
  profileGender = (await db.getKV('profile').catch(() => null))?.gender || '';
  return profileGender;
}
// Solo i capi della sezione aperta (maschile o femminile).
async function sectionItems() {
  const [all] = await Promise.all([db.getAll('items'), loadProfileGender()]);
  // Capi caricati prima degli armadi: ricevono una volta sola l'armadio del profilo e poi restano lì.
  for (const it of all) if (!it.per) { it.per = itemSection(it); await db.put('items', it); }
  return all.filter(inSection);
}
// Proposte e link per comprare seguono la sezione aperta.
const sectionProfile = (profile) => ({ ...(profile || {}), gender: currentGender() });

// ---------- utilità ----------

// append e replaceChildren del browser scriverebbero "null" per i pezzi facoltativi: si saltano.
for (const m of ['append', 'prepend', 'replaceChildren']) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function (...nodes) { return orig.apply(this, nodes.filter((n) => n != null && n !== false)); };
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

const urlCache = new Map();
function imgURL(item) {
  if (!item?.image) return '';
  const key = item.id + ':' + (item.updatedAt || item.createdAt);
  if (!urlCache.has(key)) urlCache.set(key, URL.createObjectURL(item.image));
  return urlCache.get(key);
}

// Ridimensiona la foto (max 1024 px) per risparmiare spazio e costi dell'AI.
async function resizeImage(file, max = 1024) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  let src = bitmap;
  let w; let hgt;
  if (bitmap) {
    w = bitmap.width; hgt = bitmap.height;
  } else {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Immagine non leggibile'));
      img.src = URL.createObjectURL(file);
    });
    w = src.naturalWidth; hgt = src.naturalHeight;
  }
  const scale = Math.min(1, max / Math.max(w, hgt));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(hgt * scale);
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

function chipGroup(options, selected, { multiple = false, scroll = false, onChange } = {}) {
  const current = new Set(Array.isArray(selected) ? selected : selected ? [selected] : []);
  const wrap = h('div', { class: 'chips' + (scroll ? ' scroll' : ''), role: 'group' });
  for (const [value, label] of Object.entries(options)) {
    const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(current.has(value)) }, label);
    b.addEventListener('click', () => {
      if (multiple) {
        current.has(value) ? current.delete(value) : current.add(value);
      } else {
        current.clear();
        current.add(value);
      }
      for (const el of wrap.children) el.setAttribute('aria-pressed', 'false');
      for (const [i, v] of Object.keys(options).entries()) {
        if (current.has(v)) wrap.children[i].setAttribute('aria-pressed', 'true');
      }
      onChange?.(multiple ? [...current] : [...current][0]);
    });
    wrap.append(b);
  }
  wrap.value = () => (multiple ? [...current] : [...current][0]);
  return wrap;
}

// ---------- nuovi manichini ----------
// Zona a colori pieni in cui va disegnato il capo, come negli altri manichini.
const ZONE_COLOR = { outerwear: 'ROSSO puro', dress: 'ROSSO puro', top: 'VERDE puro', bottom: 'BLU puro', shoes: 'GIALLO puro', accessory: 'ROSSO puro' };
const EN = {
  Polo: 'a polo shirt', Camicetta: 'a blouse', Top: 'a top', Felpa: 'a hoodie', Maglione: 'a knitted sweater', Cardigan: 'a cardigan',
  'Maglia sportiva': 'an athletic top', 'Camicia elegante': 'a formal shirt', Camicia: 'a shirt', 'T-shirt': 'a t-shirt',
  Jeans: 'jeans', Chino: 'chino trousers', 'Pantaloni eleganti': 'tailored trousers', 'Pantaloni sportivi': 'jogger pants', Cargo: 'cargo pants',
  Bermuda: 'bermuda shorts', Gonna: 'a skirt', Leggings: 'leggings', Vestito: 'a dress', 'Abito elegante': 'an evening gown', Completo: 'a suit', Tuta: 'a tracksuit',
  Giubbotto: 'a bomber jacket', 'Giacca di jeans': 'a denim jacket', Blazer: 'a blazer', Trench: 'a trench coat', Cappotto: 'a long wool coat',
  Piumino: 'a puffer jacket', Impermeabile: 'a rain jacket', Sneakers: 'sneakers', 'Scarpe da corsa': 'running shoes', Mocassini: 'loafers',
  'Scarpe eleganti': 'oxford dress shoes', Stivaletti: 'chelsea boots', Sandali: 'sandals', 'Décolleté': 'high heel pumps',
  Cintura: 'a belt', Borsa: 'a handbag', Sciarpa: 'a scarf', Cappello: 'a hat', Cravatta: 'a necktie',
};

// Dettagli da copiare dalla foto e parti che restano nel loro colore vero, per tipo di capo.
const DETAILS = {
  shoes: 'forma della punta, suola, intersuola, lacci, linguetta, cuciture e inserti',
  top: 'scollo, colletto, maniche, polsini, bottoni, tasche e cuciture',
  bottom: 'vestibilità, tasche, cuciture, bottoni, passanti e orlo',
  outerwear: 'colletto, cappuccio, zip, bottoni, tasche, polsini e lunghezza',
  dress: 'scollo, maniche, cuciture, lunghezza e vestibilità',
  accessory: 'forma, cuciture e dettagli',
};
const MAIN_PART = { shoes: 'la tomaia (la parte in tessuto o pelle sopra la suola)' };
const SECONDARY = {
  shoes: 'suola, intersuola, lacci e inserti', top: 'bottoni e dettagli a contrasto', bottom: 'bottoni e rivetti',
  outerwear: 'zip, bottoni e coulisse', dress: 'bottoni e dettagli', accessory: 'fibbie e metalli',
};

const OTHERS = [
  [['outerwear', 'dress'], 'giacca ROSSO puro (se c\'è)'], [['top'], 'maglia VERDE puro'],
  [['bottom'], 'pantaloni BLU puro'], [['shoes'], 'scarpe GIALLO limone puro (non ocra né senape)'],
];

// ref: il capo vero (foto, colori, materiale): il testo chiede di riprodurlo fedelmente.
// pose: una posa dei manichini dell'app (POSES): il testo chiede di copiarla dalla seconda foto.
function newMannequinPrompt(category, name, ref, pose) {
  const donna = currentGender() === 'donna';
  const what = EN[name] || name;
  const zone = ZONE_COLOR[category] || 'ROSSO puro';
  const second = ref?.colors?.[1];
  const paren = what.toLowerCase() === name.toLowerCase() ? '' : ` (${what})`;
  // Piedistallo opaco: con quello lucido le scarpe si specchiano e il riflesso si colora a blocchi.
  const lines = [
    `Crea un'immagine verticale 2:3, figura intera centrata, di un manichino ${donna ? 'femminile' : 'maschile'} nero lucido senza volto, in piedi su un piedistallo ROTONDO nero OPACO con bordo dorato (superficie opaca, le scarpe NON si specchiano, nessun riflesso sotto i piedi), sfondo nero con un cerchio dorato luminoso dietro (leggero bagliore caldo).`,
  ];
  if (pose) {
    lines.push(`Usa ESATTAMENTE la posa, l'inquadratura e le proporzioni del manichino della ${ref?.image ? 'seconda' : ''} immagine allegata (posa "${pose.label}"): stessa posizione di braccia, gambe e piedi, stessi tipi di capi.`);
  }
  if (ref?.image) {
    lines.push(
      `Il manichino indossa ${articolo(name)}${paren}: riproduci fedelmente il capo della ${pose ? 'prima ' : ''}foto allegata (forma, modello, proporzioni, ${DETAILS[category] || DETAILS.accessory}), senza scritte né loghi leggibili.`,
      `Colora ${MAIN_PART[category] || 'il tessuto principale'} in tinta unita ${zone}, così l'app può ricolorarlo; ${SECONDARY[category] || 'i dettagli'} restano del loro colore vero${second ? ` (${second})` : ''}.`,
    );
    if (ref.material) lines.push(`Materiale: ${ref.material}, con la sua trama visibile.`);
  } else {
    lines.push(`Il manichino indossa ${articolo(name)}${paren}, in tinta unita ${zone}, senza fantasie né scritte.`);
  }
  lines.push(
    `Gli altri capi in tinta unita a colori pieni e saturi: ${OTHERS.filter(([cats]) => !cats.includes(category)).map(([, t]) => t).join(', ')}.`,
    'Luce morbida da studio, pieghe del tessuto visibili, nessun altro oggetto.',
  );
  return lines.join(' ');
}

// Manda testo e foto del capo all'app scelta (menu Condividi di Android: ChatGPT, Gemini…).
async function shareToAI(prompt, files, fallback) {
  const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
  if (list.length && navigator.canShare?.({ files: list })) {
    try { await navigator.share({ text: prompt, files: list }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  fallback();
}

async function showNewMannequin(category, name, ref, pose) {
  const prompt = newMannequinPrompt(category, name, ref, pose);
  const ext = ref?.image?.type?.split('/')[1] || 'jpg';
  const file = ref?.image ? new File([ref.image], `capo.${ext}`, { type: ref.image.type || 'image/jpeg' }) : null;
  const photoURL = file ? URL.createObjectURL(file) : null;
  // La posa: l'immagine del manichino dell'app parte insieme al testo.
  let poseFile = null;
  if (pose) {
    try {
      const blob = await (await fetch(`img/manichino/${pose.base}.jpg`)).blob();
      poseFile = new File([blob], `posa-${pose.base}.jpg`, { type: 'image/jpeg' });
    } catch { /* senza rete: la foto della posa si salva a mano */ }
  }
  const files = [file, poseFile].filter(Boolean);
  const poseURL = pose ? `img/manichino/${pose.base}.jpg` : null;
  openDialog((close) => h('div', { class: 'sheet' },
    sheetHead(`Nuovo manichino: ${name}`, close),
    pose ? h('p', {}, `Crea con ChatGPT o Gemini ${articolo(name)} sulla posa "${pose.label}" e caricalo qui: nelle proposte con questa posa l'app userà il tuo.`) : null,
    pose ? h('div', { class: 'refphoto' },
      h('img', { src: poseURL, alt: `Posa ${pose.label}` }),
      h('p', { class: 'hint' }, 'Parte anche questa immagine, così copia la posa.', ' ', h('a', { href: poseURL, download: `posa-${pose.base}.jpg` }, 'Salva la posa'))) : null,
    pose ? null : h('p', {}, mannequinMatch(category, name)?.same
      ? `Crea con ChatGPT o Gemini un manichino con ${articolo(name)} e caricalo qui: l'app lo prepara da sola e per questo capo userà il tuo al posto di quello dell'app.`
      : `I manichini ${currentGender()} non hanno ${articolo(name)}. Puoi crearne uno con ChatGPT o Gemini e caricarlo qui: l'app lo prepara da sola.`),
    file ? h('div', { class: 'refphoto' },
      h('img', { src: photoURL, alt: 'Foto del tuo capo', class: ref.cutout ? 'cut' : null }),
      h('p', { class: 'hint' }, 'Insieme al testo parte la foto del tuo capo, così lo riproduce fedelmente: forma, suola, lacci, cuciture.',
        ' ', h('a', { href: photoURL, download: `capo.${ext}` }, 'Salva la foto'))) : null,
    h('ol', { class: 'steps' },
      h('li', {}, files.length ? `Tocca ChatGPT o Gemini e scegli l'app dal menu: partono il testo e ${files.length > 1 ? 'le foto' : 'la foto'}.` : 'Tocca ChatGPT o Gemini: si apre col testo già pronto.'),
      h('li', {}, `Controlla che la parte principale sia ${ZONE_COLOR[category] || 'ROSSO puro'} pieno e gli altri capi nei loro colori pieni.`),
      h('li', {}, 'Salva l\'immagine sul telefono e tocca "Carica il manichino".')),
    h('textarea', { class: 'prompt', readonly: true, rows: 7 }, prompt),
    h('div', { class: 'row' },
      h('button', {
        type: 'button', class: 'btn primary',
        onclick: () => shareToAI(prompt, files, () => window.open(`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`, '_blank', 'noopener')),
      }, 'Crea con ChatGPT'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => shareToAI(prompt, files, () => openGemini(prompt)) }, 'Crea con Gemini')),
    h('div', { class: 'row end' },
      h('button', {
        type: 'button', class: 'btn',
        onclick: async () => {
          try { await navigator.clipboard.writeText(prompt); toast('Testo copiato'); } catch { toast('Tieni premuto sul testo per copiarlo'); }
        },
      }, 'Copia il testo'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => { close(); openMannequinEditor({ category, name, pose }); } }, 'Carica il manichino'))));
}

// ---------- manichino creato da te ----------
const ZONE_LABEL = { 1: 'Giacca', 2: 'Maglia', 3: 'Pantaloni', 4: 'Scarpe' };
const ZONE_DOT = { 1: '#e65050', 2: '#5ac86e', 3: '#5a82f0', 4: '#f0d246' };
const ZONE_DEFAULT = { 1: 'Giubbotto', 2: 'T-shirt', 3: 'Jeans', 4: 'Sneakers' };
// Colori neutri per provare il manichino; la zona "da provare" prende il colore scelto.
const TRY_BASE = { 1: 'blu navy', 2: 'bianco', 3: 'denim', 4: 'bianco' };
const TRY_COLORS = ['bordeaux', 'blu navy', 'grigio', 'verde oliva', 'beige', 'nero'];
const MIN_ZONE = 1500; // pixel sotto i quali una zona non c'è

function openMannequinEditor({ category, name, onSaved, pose } = {}) {
  openDialog((close) => {
    const wrap = h('div', { class: 'sheet' });
    const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const body = h('div');
    let prepared = null;

    const pick = () => fileIn.click();
    const intro = () => body.replaceChildren(
      h('p', {}, 'Carica l\'immagine del manichino fatta con ChatGPT o Gemini, con i capi a colori pieni: giacca rossa, maglia verde, pantaloni blu, scarpe gialle.'),
      category ? h('p', { class: 'hint' }, `${articolo(name)[0].toUpperCase()}${articolo(name).slice(1)} va in ${ZONE_COLOR[category] || 'ROSSO puro'}.${pose ? ` Posa: ${pose.label}.` : ''}`) : null,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: pick }, 'Scegli l\'immagine'),
        category ? h('button', { type: 'button', class: 'btn', onclick: () => { close(); showNewMannequin(category, name, null, pose); } }, 'Testo per crearlo') : null),
    );

    fileIn.addEventListener('change', async () => {
      const file = fileIn.files?.[0];
      fileIn.value = '';
      if (!file) return;
      body.replaceChildren(h('div', { class: 'status' }, h('span', { class: 'spinner' }), 'Preparo il manichino…'));
      try {
        prepared = await prepareMannequin(file);
      } catch (e) {
        console.warn('manichino', e);
        toast('Non riesco a leggere l\'immagine.');
        intro();
        return;
      }
      showPrepared(file);
    });

    const showPrepared = (file) => {
      const zones = [1, 2, 3, 4].filter((z) => prepared.counts[z] >= MIN_ZONE);
      prepared.overlay.className = 'pair-canvas';
      const pair = h('div', { class: 'pair' },
        h('figure', {}, h('img', { class: 'preview', src: URL.createObjectURL(file), alt: 'La tua immagine' }), h('figcaption', {}, 'La tua immagine')),
        h('figure', {}, prepared.overlay, h('figcaption', {}, 'Zone trovate')));
      const zoneList = h('div', { class: 'zones' }, [1, 2, 3, 4].map((z) => h('div', { class: 'z' + (zones.includes(z) ? '' : ' off') },
        h('span', { class: 'dot', style: `background:${ZONE_DOT[z]}` }), ZONE_LABEL[z],
        h('small', {}, zones.includes(z) ? '✓' : 'non c\'è'))));
      if (!zones.length) {
        body.replaceChildren(pair, zoneList,
          h('p', { class: 'match warn' }, 'Non trovo capi a colori pieni. Controlla che giacca, maglia, pantaloni e scarpe siano rosso, verde, blu e giallo puri.'),
          h('button', { type: 'button', class: 'btn', onclick: pick }, 'Scegli un\'altra immagine'));
        return;
      }
      // Che capi sono: un tipo per ogni zona trovata.
      const presetZone = category ? zoneOfCategory(category) : 0;
      const selects = {};
      for (const z of zones) {
        const sel = h('select');
        for (const cat of ZONE_CATEGORIES[z]) {
          const group = h('optgroup', { label: CATEGORIES[cat] });
          for (const tp of SUBTYPES[cat] || []) group.append(h('option', { value: tp.name }, tp.name));
          sel.append(group);
        }
        sel.value = z === presetZone ? name : ZONE_DEFAULT[z];
        if (!sel.value) sel.selectedIndex = 0;
        selects[z] = sel;
      }
      const gender = chipGroup({ uomo: 'Uomo', donna: 'Donna' }, currentGender());
      const pubBox = h('input', { type: 'checkbox' });
      const pubRow = h('label', { class: 'check', hidden: true }, pubBox, ' Pubblica per tutti gli utenti dell\'app');
      isAdmin().then((v) => { if (v) { pubRow.hidden = false; pubBox.checked = true; } });
      const occasions = chipGroup(OCCASIONS, pose?.occasions || ['tempo_libero'], { multiple: true });
      const nameIn = h('input', { type: 'text', placeholder: 'es. Maglione e cargo' });
      const autoName = () => {
        const parts = zones.map((z) => selects[z].value);
        const main = presetZone && selects[presetZone] ? selects[presetZone].value : parts[0];
        const other = parts.find((x) => x !== main && /pantaloni|jeans|cargo|chino|leggings|bermuda|gonna|shorts/i.test(x));
        return other ? `${main} e ${other.toLowerCase()}` : main;
      };
      let nameTouched = false;
      nameIn.value = autoName();
      nameIn.addEventListener('input', () => { nameTouched = true; });

      // Prova colori.
      let focus = presetZone && zones.includes(presetZone) ? presetZone : zones.includes(2) ? 2 : zones[0];
      let tryColor = TRY_COLORS[0];
      const canvas = h('canvas', { class: 'pair-canvas', 'aria-label': 'Anteprima del manichino' });
      const paint = () => {
        const p = {};
        for (const z of zones) p[z] = PALETTE[z === focus ? tryColor : TRY_BASE[z]];
        previewPhoto(canvas, prepared.base, prepared.zone, p).catch(() => {});
      };
      const swatches = h('div', { class: 'chips' }, TRY_COLORS.map((c) => {
        const [r, g, b] = PALETTE[c];
        return h('button', {
          type: 'button', class: 'chip', 'aria-pressed': String(c === tryColor),
          onclick: (e) => {
            tryColor = c;
            for (const el of swatches.children) el.setAttribute('aria-pressed', 'false');
            e.currentTarget.setAttribute('aria-pressed', 'true');
            paint();
          },
        }, h('span', { class: 'swatch', style: `background: rgb(${r},${g},${b})` }), c);
      }));
      const focusChips = chipGroup(Object.fromEntries(zones.map((z) => [String(z), ZONE_LABEL[z]])), String(focus), {
        onChange: (v) => { focus = Number(v); paint(); },
      });
      for (const z of zones) selects[z].addEventListener('change', () => { selects[z].dataset.touched = '1'; if (!nameTouched) nameIn.value = autoName(); });
      paint();
      // Il tipo degli altri capi si prova a indovinare dalla forma (stesso riconoscimento dell'armadio).
      (async () => {
        for (const z of zones) {
          if (z === presetZone || !prepared.crops?.[z]) continue;
          try {
            const { types } = await analyzeGarment(prepared.crops[z], 80);
            const best = types.find((t) => ZONE_CATEGORIES[z].includes(t.category));
            if (best && !selects[z].dataset.touched) {
              selects[z].value = best.name;
              if (!nameTouched) nameIn.value = autoName();
            }
          } catch { /* resta il tipo proposto */ }
        }
      })();

      const save = async () => {
        const occ = occasions.value();
        if (!occ.length) { toast('Scegli almeno un\'occasione.'); return; }
        const garments = { 1: null, 2: null, 3: null, 4: null };
        for (const z of zones) garments[z] = selects[z].value;
        const m = {
          id: db.newId(), name: nameIn.value.trim() || autoName(), gender: gender.value(), occasions: occ,
          garments, main: presetZone && garments[presetZone] ? garments[presetZone] : null, pose: pose?.base || null, base: prepared.base, zone: prepared.zone, createdAt: new Date().toISOString(),
        };
        try {
          await saveCustom(m);
        } catch (e) {
          console.warn('manichino', e);
          toast('Non sono riuscito a salvare il manichino.');
          return;
        }
        if (pubBox.checked) {
          try { await publishShared(m); toast(`Manichino "${m.name}" aggiunto e pubblicato per tutti`); } catch (e) { toast('Salvato, ma non pubblicato: ' + sync.friendlyError(e)); }
        } else toast(`Manichino "${m.name}" aggiunto`);
        close();
        onSaved?.();
        window.dispatchEvent(new Event('manichini'));
        route();
      };

      body.replaceChildren(pair, zoneList,
        h('h2', {}, 'Che capi mostra?'),
        ...zones.map((z) => h('label', { class: 'field' }, h('span', {}, ZONE_LABEL[z]), selects[z])),
        field('Nome', nameIn),
        h('div', { class: 'field' }, h('span', {}, 'Per'), gender),
        h('div', { class: 'field' }, h('span', {}, 'Occasioni'), occasions),
        pubRow,
        h('h2', {}, 'Prova i colori'),
        h('p', { class: 'hint' }, 'Tocca un colore per vedere se luci e ombre vengono bene.'),
        zones.length > 1 ? focusChips : null,
        swatches,
        h('div', { class: 'try' }, canvas),
        h('div', { class: 'row end' },
          h('button', { type: 'button', class: 'btn', onclick: pick }, 'Cambia immagine'),
          h('button', { type: 'button', class: 'btn primary', onclick: save }, 'Salva manichino')));
    };

    intro();
    wrap.append(sheetHead('Nuovo manichino', close), body, fileIn);
    return wrap;
  });
}

// Elenco nelle Impostazioni: i manichini creati da te, con anteprima e "Togli".
function mannequinSection() {
  const box = h('div');
  let admin = false;
  const card = (c) => {
    const cv = h('canvas', { 'aria-label': c.name });
    const p = {};
    for (const z of [1, 2, 3, 4]) if (c.garments?.[z]) p[z] = PALETTE[TRY_BASE[z]];
    previewPhoto(cv, c.base, c.zone, p).catch(() => {});
    const busy = async (btn, fn, ok) => {
      btn.disabled = true;
      try { await fn(); toast(ok); } catch (e) { console.warn('manichini', e); toast('Non riuscito: ' + sync.friendlyError(e)); }
      paintList();
    };
    const actions = [];
    if (!c.shared) {
      actions.push(h('button', {
        type: 'button', class: 'linkbtn',
        onclick: async () => {
          if (!confirm(c.published ? `Togliere "${c.name}"? Sparisce anche per tutti gli utenti.` : `Togliere il manichino "${c.name}"?`)) return;
          if (c.published) { try { await unpublishShared(c.id); } catch (e) { toast('Non riuscito: ' + sync.friendlyError(e)); return; } }
          await removeCustom(c.id);
          forgetPhoto(`mio:${c.id}`);
          paintList();
          toast('Manichino tolto');
        },
      }, 'Togli'));
      if (admin) {
        const pub = h('button', { type: 'button', class: 'linkbtn' }, c.published ? 'Togli da tutti' : 'Pubblica per tutti');
        pub.addEventListener('click', () => (c.published
          ? busy(pub, () => unpublishShared(c.id), 'Tolto dal catalogo di tutti')
          : busy(pub, () => publishShared(c), 'Pubblicato: ora lo vedono tutti')));
        if (!c.definitivo) actions.push(pub);
        // Rende il manichino parte fissa dell'app (nel codice), come quelli di partenza.
        if (!c.definitivo) {
          const fix = h('button', { type: 'button', class: 'linkbtn' }, 'Rendi definitivo');
          fix.addEventListener('click', () => {
            if (!confirm(`Rendere definitivo "${c.name}"?\n\nEntra nella collezione fissa dell'app per tutti, come i manichini di partenza, ed esce dai tuoi e da quelli pubblicati. Ci vuole circa un'ora.`)) return;
            busy(fix, () => makeDefinitive(c), 'Fatto: entro un\'ora circa sarà un manichino dell\'app');
          });
          actions.push(fix);
        }
      }
    }
    return h('figure', {}, cv,
      h('figcaption', {}, c.name, h('small', {}, ` · ${c.gender}${c.shared ? ' · per tutti' : c.definitivo ? ' · sta entrando nell\'app' : c.published ? ' · pubblicato' : ''}`)),
      ...actions);
  };
  const paintList = () => {
    const mine = CUSTOM.filter((c) => !c.shared && !c.fixed);
    const shared = CUSTOM.filter((c) => c.shared);
    box.replaceChildren(...[
      h('p', { class: 'hint' }, `L'app ha già ${fixedCount('uomo')} manichini uomo e ${fixedCount('donna')} donna. Qui aggiungi i tuoi, fatti con ChatGPT o Gemini: restano su questo telefono, sono nel backup e per i tuoi capi vincono su quelli dell'app.`),
      admin ? h('p', { class: 'hint' }, 'Sei l\'amministratore: con "Pubblica per tutti" un tuo manichino arriva a tutti gli utenti dell\'app; con "Rendi definitivo" entra per sempre nei manichini dell\'app ed esce da questo elenco.') : null,
      h('div', { class: 'mlist' }, ...mine.map(card),
        h('button', { type: 'button', class: 'madd', onclick: () => openMannequinEditor({ onSaved: paintList }) }, h('span', {}, '+'), 'Aggiungi')),
      shared.length ? h('h3', {}, 'Manichini per tutti') : null,
      shared.length ? h('div', { class: 'mlist' }, ...shared.map(card)) : null].filter(Boolean));
  };
  paintList();
  isAdmin().then((v) => { if (v) { admin = true; paintList(); } });
  syncShared().then((changed) => { if (changed) paintList(); }).catch(() => {});
  return box;
}

// Gemini non accetta il testo nell'indirizzo: sul telefono si condivide il testo con l'app Gemini
// (menu Condividi di Android); se non si può, si copia e si apre Gemini nel browser.
async function openGemini(prompt) {
  if (navigator.share) {
    try { await navigator.share({ text: prompt }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(prompt); toast('Testo copiato: incollalo in Gemini'); } catch { /* niente */ }
  window.open('https://gemini.google.com/app', '_blank', 'noopener');
}

// ref: funzione che restituisce il capo vero (foto, colori, materiale) al momento del tocco.
// Il capo c'è su un manichino tuo: le altre pose dell'app dove puoi crearlo (es. le sneakers
// anche sulla posa della serata). Quelle già fatte hanno la spunta.
function posesBox(category, name, ref) {
  const g = currentGender();
  const z = zoneOfCategory(category);
  if (!z) return null;
  const poses = posesFor(g, category, name);
  if (!poses.length) return null;
  const done = (p) => CUSTOM.some((c) => c.gender === g && c.garments?.[z] === name && c.pose === p.base);
  const n = poses.filter(done).length;
  return h('details', { class: 'poses' },
    h('summary', {}, `${articolo(name)[0].toUpperCase()}${articolo(name).slice(1)} anche su altre pose (${n}/${poses.length})`),
    h('p', { class: 'hint' }, 'Il tuo manichino si usa già in tutte le proposte con questo capo, ma con la sua posa. Creane uno sulla posa di un manichino dell\'app e nelle proposte con quella posa l\'app userà il tuo.'),
    h('div', { class: 'pose-grid' }, poses.map((p) => h('div', { class: 'pose' + (done(p) ? ' done' : '') },
      h('img', { src: `img/manichino/${p.base}.jpg`, alt: p.label, loading: 'lazy' }),
      h('small', {}, p.label),
      done(p) ? h('span', { class: 'pose-ok' }, '✓ Fatto')
        : h('button', { type: 'button', class: 'btn small', onclick: () => showNewMannequin(category, name, ref?.(), p) }, 'Crea')))));
}

function newMannequinButton(category, name, label = 'Come creare il manichino', ref) {
  return h('div', {}, h('button', { type: 'button', class: 'btn small', onclick: () => showNewMannequin(category, name, ref?.()) }, label));
}

// Distanza tra due colori come la vede l'occhio (Lab).
function labDistance(a, b) {
  const lab = ([r, g, bl]) => {
    const lin = (c) => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
    const [R, G, B] = [lin(r), lin(g), lin(bl)];
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
    const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
    const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const p = lab(a); const q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// "la felpa", "il blazer", "i jeans"... per le frasi dell'app.
function articolo(name) {
  const n = name.toLowerCase();
  if (/^(jeans|chino|pantaloni|leggings|bermuda|cargo|sandali|mocassini|stivaletti|décolleté)/.test(n)) return `i ${n}`;
  if (/^(scarpe)/.test(n)) return `le ${n}`;
  if (/^(sneakers)/.test(n)) return `le ${n}`;
  if (/^[aeiou]/.test(n)) return `l'${n}`;
  if (/^(felpa|camicia|camicetta|giacca|polo|maglia|gonna|tuta|t-shirt|cintura|borsa|sciarpa|cravatta)/.test(n)) return `la ${n}`;
  if (/^(s[^aeiou]|z|ps|gn)/.test(n)) return `lo ${n}`;
  return `il ${n}`;
}

function field(label, control) {
  return h('label', { class: 'field' }, h('span', {}, label), control);
}

function select(options, value, { empty } = {}) {
  const s = h('select');
  if (empty) s.append(h('option', { value: '' }, empty));
  for (const [v, l] of Object.entries(options)) s.append(h('option', { value: v, selected: String(v) === String(value) }, l));
  return s;
}

function openDialog(build) {
  const dlg = h('dialog');
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(build(close));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.append(dlg);
  dlg.showModal();
  return close;
}

function sheetHead(title, close) {
  return h('div', { class: 'sheet-head' },
    h('h2', {}, title),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Chiudi', onclick: close }, '✕'));
}

// ---------- Armadio ----------

let wardrobeFilter = 'all';

// Layout dell'armadio: 'scaffali' (righe per tipo da scorrere), 'griglia', 'lista'.
const LAYOUTS = { scaffali: 'Scaffali', griglia: 'Griglia', lista: 'Lista' };
let wardrobeLayout = (() => { try { return localStorage.getItem('menga-armadio') || 'scaffali'; } catch { return 'scaffali'; } })();
let wardrobeSearch = '';
let wardrobeSort = 'tipo';
const SORTS = { tipo: 'Tipo', colore: 'Colore', recenti: 'Recenti', usati: 'Più indossati' };
const ORDER = ['outerwear', 'top', 'dress', 'bottom', 'shoes', 'accessory'];

const LAYOUT_ICONS = {
  scaffali: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 4h18v2H3zm0 5h5v5H3zm7 0h5v5h-5zm7 0h4v5h-4zM3 17h18v2H3z"/></svg>',
  griglia: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 3h5v5H3zm6.5 0h5v5h-5zM16 3h5v5h-5zM3 9.5h5v5H3zm6.5 0h5v5h-5zm6.5 0h5v5h-5zM3 16h5v5H3zm6.5 0h5v5h-5zm6.5 0h5v5h-5z"/></svg>',
  lista: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 4h5v5H3zm7 1h11v3H10zM3 15h5v5H3zm7 1h11v3H10z"/></svg>',
};

function colorDots(it) {
  return (it.colors || []).filter((c) => PALETTE[c]).map((c) => h('span', { class: 'dot', title: c, style: `background: rgb(${PALETTE[c].join(',')})` }));
}

function wardrobeTile(it) {
  const m = mannequinMatch(it.category, it.subcategory);
  return h('button', { class: 'tile', type: 'button', onclick: () => editItem(it) },
    h('img', { src: imgURL(it), alt: describeItem(it), loading: 'lazy', class: it.cutout ? 'cut' : null }),
    m?.same === false ? h('span', { class: 'tile-warn', title: 'Non c\'è sui manichini' }, '⚠') : null,
    h('span', { class: 'tag' }, colorDots(it).slice(0, 1), it.subcategory || CATEGORIES[it.category] || 'Capo'));
}

function wardrobeRow(it) {
  const m = mannequinMatch(it.category, it.subcategory);
  const status = !m ? h('span', { class: 'st muted' }, 'Tipo libero')
    : m.same ? h('span', { class: 'st ok' }, '✓ Manichino')
      : h('span', { class: 'st warn' }, m.garment ? `⚠ Come ${m.garment}` : '⚠ Non sul manichino');
  return h('button', { class: 'wrow', type: 'button', onclick: () => editItem(it) },
    h('img', { src: imgURL(it), alt: describeItem(it), loading: 'lazy', class: it.cutout ? 'cut' : null }),
    h('span', { class: 'wrow-body' },
      h('strong', {}, it.subcategory || CATEGORIES[it.category] || 'Capo'),
      h('span', { class: 'wrow-colors' }, colorDots(it), (it.colors || []).join(', ') || 'colore non indicato'),
      h('span', { class: 'wrow-meta' }, it.timesWorn ? `Indossato ${it.timesWorn} ${it.timesWorn === 1 ? 'volta' : 'volte'}` : 'Mai indossato', it.brand ? ` · ${it.brand}` : '')),
    status);
}

async function renderWardrobe() {
  titleEl.textContent = 'Il mio armadio';
  const items = (await sectionItems()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  view.replaceChildren();

  if (!items.length) {
    view.append(h('div', { class: 'empty' },
      h('strong', {}, 'Il tuo armadio è vuoto'),
      'Tocca + per fotografare il primo capo: l\'app riconosce tipo e colori e lo collega ai manichini.'));
  } else {
    // Barra in alto: quanti capi, avviso manichini (compatto) e scelta del layout.
    const missing = items.filter((it) => mannequinMatch(it.category, it.subcategory)?.same === false);
    const kinds = [...new Map(missing.map((it) => [`${it.category}|${it.subcategory}`, it])).values()];
    const switcher = h('div', { class: 'seg', role: 'group', 'aria-label': 'Layout' },
      Object.entries(LAYOUTS).map(([k, label]) => h('button', {
        type: 'button', class: 'seg-btn', 'aria-pressed': String(wardrobeLayout === k), title: label, 'aria-label': label,
        html: LAYOUT_ICONS[k],
        onclick: () => { wardrobeLayout = k; try { localStorage.setItem('menga-armadio', k); } catch { /* niente */ } renderWardrobe(); },
      })));
    view.append(h('div', { class: 'wbar' },
      h('span', { class: 'wbar-count' }, `${items.length} ${items.length === 1 ? 'capo' : 'capi'}`),
      kinds.length ? h('button', {
        type: 'button', class: 'pill warn',
        onclick: () => openDialog((close) => h('div', { class: 'sheet' },
          sheetHead('Manichini da creare', close),
          h('p', { class: 'hint' }, `Questi tipi non ci sono sui manichini ${currentGender()}. Tocca un tipo per avere il testo per crearlo.`),
          h('div', { class: 'chips' }, kinds.map((it) => h('button', {
            type: 'button', class: 'chip', onclick: () => showNewMannequin(it.category, it.subcategory, it),
          }, `${it.subcategory} · ${missing.filter((x) => x.subcategory === it.subcategory).length}`))))),
      }, `⚠ ${kinds.length} da creare`) : null,
      switcher));

    const byType = (a, b) => (a.subcategory || '').localeCompare(b.subcategory || '', 'it')
      || (a.colors?.[0] || '').localeCompare(b.colors?.[0] || '', 'it');
    const groupsOf = (list) => [...ORDER, '']
      .map((cat) => [cat, list.filter((i) => (cat ? i.category === cat : !ORDER.includes(i.category))).sort(byType)])
      .filter(([, l]) => l.length);

    if (wardrobeLayout === 'scaffali') {
      // Una riga da scorrere per ogni gruppo, dalla testa ai piedi.
      for (const [cat, list] of groupsOf(items)) {
        view.append(h('section', { class: 'shelf' },
          h('button', {
            type: 'button', class: 'shelf-head',
            onclick: () => { wardrobeFilter = cat || 'all'; wardrobeLayout = 'griglia'; renderWardrobe(); },
          }, h('h2', {}, CATEGORIES[cat] || 'Senza categoria'), h('span', { class: 'wgroup-count' }, String(list.length)), h('span', { class: 'shelf-more' }, 'Vedi tutti ›')),
          h('div', { class: 'shelf-row' }, list.map(wardrobeTile))));
      }
    } else {
      // Griglia e lista: filtri per gruppo, ricerca e ordine.
      const count = (cat) => items.filter((i) => i.category === cat).length;
      const filters = { all: `Tutti · ${items.length}` };
      for (const cat of ORDER) if (count(cat)) filters[cat] = `${CATEGORIES[cat]} · ${count(cat)}`;
      if (wardrobeFilter !== 'all' && !filters[wardrobeFilter]) wardrobeFilter = 'all';
      view.append(chipGroup(filters, wardrobeFilter, { scroll: true, onChange: (v) => { wardrobeFilter = v; renderWardrobe(); } }));
      const search = h('input', { type: 'search', class: 'wsearch', placeholder: 'Cerca: blazer, blu, Zara…', value: wardrobeSearch });
      const sort = select(SORTS, wardrobeSort);
      view.append(h('div', { class: 'wtools' }, search, sort));
      const results = h('div');
      view.append(results);
      const paint = () => {
        const q = wardrobeSearch.trim().toLowerCase();
        let list = wardrobeFilter === 'all' ? items : items.filter((i) => i.category === wardrobeFilter);
        if (q) list = list.filter((it) => [it.subcategory, CATEGORIES[it.category], ...(it.colors || []), it.brand, it.notes, it.material].join(' ').toLowerCase().includes(q));
        const cmp = {
          tipo: byType,
          colore: (a, b) => (a.colors?.[0] || '').localeCompare(b.colors?.[0] || '', 'it') || byType(a, b),
          recenti: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
          usati: (a, b) => (b.timesWorn || 0) - (a.timesWorn || 0),
        }[wardrobeSort];
        results.replaceChildren();
        if (!list.length) { results.append(h('div', { class: 'empty' }, 'Nessun capo trovato.')); return; }
        const make = wardrobeLayout === 'lista' ? wardrobeRow : wardrobeTile;
        const box = (l) => h('div', { class: wardrobeLayout === 'lista' ? 'wlist' : 'grid grid3' }, l.map(make));
        if (wardrobeSort === 'tipo' && wardrobeFilter === 'all' && !q) {
          for (const [cat, l] of groupsOf(list)) {
            results.append(h('section', { class: 'wgroup' },
              h('div', { class: 'wgroup-head' }, h('h2', {}, CATEGORIES[cat] || 'Senza categoria'), h('span', { class: 'wgroup-count' }, String(l.length))),
              box(l)));
          }
        } else {
          results.append(box(list.slice().sort(cmp)));
        }
      };
      search.addEventListener('input', () => { wardrobeSearch = search.value; paint(); });
      sort.addEventListener('change', () => { wardrobeSort = sort.value; paint(); });
      paint();
    }
  }

  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const gallery = h('input', { type: 'file', accept: 'image/*', hidden: true });
  for (const input of [camera, gallery]) {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) addItemFromFile(file);
    });
  }
  const chooseSource = () => openDialog((close) => h('div', { class: 'sheet' },
    sheetHead('Aggiungi un capo', close),
    h('p', { class: 'hint' }, 'Consiglio: fotografa il capo steso o appeso, su uno sfondo chiaro e uniforme.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => { close(); camera.click(); } }, 'Scatta foto'),
      h('button', { class: 'btn', type: 'button', onclick: () => { close(); gallery.click(); } }, 'Scegli dalla galleria'))));
  view.append(camera, gallery, h('button', { class: 'fab', type: 'button', 'aria-label': 'Aggiungi capo', onclick: chooseSource }, '+'));
}

async function addItemFromFile(file) {
  let blob;
  try {
    blob = await resizeImage(file);
  } catch {
    toast('Non riesco a leggere questa foto.');
    return;
  }
  const item = {
    id: db.newId(),
    createdAt: new Date().toISOString(),
    image: blob,
    category: '', subcategory: '', colors: [], pattern: 'solid', material: '',
    seasons: [], formality: 3, styles: [], brand: '', size: '', notes: '',
    timesWorn: 0, lastWorn: null,
    per: fixedSection() || 'entrambi',
  };
  editItem(item, { isNew: true });
}

// A cosa somiglia una foto che non è un capo (nomi di tools/modello/non-capi.json).
const NOT_GARMENT = {
  mappa: 'una mappa', schermata: 'una schermata', documento: 'un documento o un testo', paesaggio: 'un paesaggio',
  città: 'una strada o un palazzo', stanza: 'una stanza', veicolo: 'un veicolo', cibo: 'del cibo', animale: 'un animale',
  volto: 'un volto', oggetto: 'un oggetto', pianta: 'una pianta o dei fiori', grafica: 'un disegno o una scritta',
};

function editItem(item, { isNew = false } = {}) {
  openDialog((close) => {
    const wrap = h('div', { class: 'sheet' });
    const status = h('div');
    const photo = h('img', { class: item.cutout ? 'preview cut' : 'preview', src: URL.createObjectURL(item.image), alt: 'Foto del capo' });
    const bgSlot = h('div', { class: 'bgslot' });
    const mannequinSlot = h('figure', { class: 'pair-look' });
    const preview = h('div', { class: 'pair' }, h('figure', {}, photo, h('figcaption', {}, 'La tua foto')), mannequinSlot);

    const f = {
      subcategory: h('input', { type: 'text', value: item.subcategory, placeholder: 'es. Camicia oxford' }),
      colors: h('input', { type: 'text', value: (item.colors || []).join(', '), placeholder: 'es. blu, bianco' }),
      pattern: select(PATTERNS, item.pattern),
      material: h('input', { type: 'text', value: item.material, placeholder: 'es. cotone' }),
      formality: select(FORMALITY, item.formality || 3),
      brand: h('input', { type: 'text', value: item.brand || '' }),
      size: h('input', { type: 'text', value: item.size || '', placeholder: 'es. M, 42' }),
      notes: h('textarea', {}, item.notes || ''),
    };
    let category = item.category;
    let per = itemSection(item);
    const perChips = chipGroup(ARMADI, per, {
      onChange: (v) => { per = v; },
    });
    let lastEmb = null; // impronta della foto, per ricordare il tipo scelto
    let lastEmbImage = null;
    let seasons = chipGroup(SEASONS, item.seasons, { multiple: true });
    let styles = chipGroup(STYLES, item.styles, { multiple: true });
    const seasonsSlot = h('div', {}, seasons);
    const stylesSlot = h('div', {}, styles);
    const typesSlot = h('div');
    const matchSlot = h('div');
    const guessSlot = h('div');

    // Capo corrispondente sui manichini, aggiornato a ogni cambio di categoria o tipo.
    // Il capo com'è adesso nella scheda: per il testo del manichino fedele.
    const capoVero = () => ({
      image: item.image, cutout: item.cutout, material: f.material.value.trim(), pattern: f.pattern.value,
      colors: f.colors.value.split(',').map((x) => x.trim()).filter(Boolean),
    });
    const paintMatch = () => {
      const name = f.subcategory.value.trim();
      if (!category || !name) { matchSlot.replaceChildren(); paintMannequin(); return; }
      const m = mannequinMatch(category, name);
      const who = currentGender() === 'donna' ? 'manichini donna' : 'manichini uomo';
      let box;
      if (!m) {
        box = h('div', { class: 'match warn' }, h('strong', {}, '⚠ Tipo non riconosciuto'),
          `"${name}" non è tra i tipi dell'app: scegli un tipo qui sopra per collegarlo a un capo dei ${who}.`);
      } else if (m.same && m.custom) {
        const mine = CUSTOM.find((c) => c.id === m.custom);
        const notMine = mine?.shared || mine?.fixed;
        box = h('div', { class: 'match ok' }, h('strong', {}, `✓ Sul ${notMine ? '' : 'tuo '}manichino${mine ? ` "${mine.name}"` : ''}`),
          notMine ? `È uno dei manichini ${mine.fixed ? 'dell\'app' : 'per tutti'}. Se qualcosa non torna puoi farne uno tuo: prende il suo posto.`
            : 'Se qualcosa non torna puoi rifarlo: quello nuovo prende il suo posto.',
          newMannequinButton(category, name, notMine ? 'Crea un manichino tuo' : 'Rifai il manichino', capoVero),
          posesBox(category, name, capoVero));
      } else if (m.same) {
        box = h('div', { class: 'match ok' }, h('strong', {}, `✓ Sui manichini: ${m.garment}`),
          `I ${who} hanno lo stesso capo, l'anteprima lo mostra col suo colore. Se sul manichino non viene bene, puoi crearne uno tuo per questo capo.`,
          newMannequinButton(category, name, 'Crea un manichino per questo capo', capoVero));
      } else {
        box = h('div', { class: 'match warn' }, h('strong', {}, `⚠ Serve un nuovo manichino: i ${who} non hanno ${articolo(name)}`),
          m.garment ? `Per ora nell'anteprima appare come il capo più simile: ${m.garment}.` : 'Per ora nell\'anteprima non compare.',
          newMannequinButton(category, name, undefined, capoVero));
      }
      // Fantasie che il manichino non sa ridisegnare.
      const pat = f.pattern.value;
      if (['floral', 'printed', 'other'].includes(pat)) {
        box.append(h('p', { class: 'match-note' }, `La fantasia "${PATTERNS[pat]}" non si può ridisegnare sul manichino: usa il colore principale${m?.same ? '. Se ti serve proprio, crea un manichino con questo capo.' : '.'}`));
      }
      matchSlot.replaceChildren(box);
      paintMannequin();
    };

    // Accanto alla foto: il manichino neutro con colorato solo questo capo.
    let lastLook = '';
    // Manichino nuovo salvato mentre la scheda è aperta: si ridisegna.
    const onMannequins = () => { lastLook = ''; paintMatch(); };
    window.addEventListener('manichini', onMannequins);
    const paintMannequin = () => {
      const name = f.subcategory.value.trim();
      const colors = f.colors.value.split(',').map((x) => x.trim()).filter(Boolean);
      const key = [category, name, colors.join(','), f.pattern.value, currentGender()].join('|');
      if (key === lastLook) return;
      lastLook = key;
      const g = category && name ? garmentView(category, name, colors, f.pattern.value) : null;
      if (!g) {
        mannequinSlot.replaceChildren(h('div', { class: 'pair-empty' },
          category && name ? 'Questo capo non compare sui manichini' : 'Scegli il tipo per vederlo sul manichino'));
        return;
      }
      mannequinSlot.replaceChildren(g.view, h('figcaption', {}, g.same ? `Sul manichino: ${g.garment}` : `Come ${g.garment} (il più simile)`));
    };

    // Scegliendo il tipo (es. "Felpa") compilo formalità, stagioni e stili: si possono cambiare.
    const applyType = (tp) => {
      f.subcategory.value = tp.name;
      paintMatch();
      f.formality.value = String(tp.formality);
      seasons = chipGroup(SEASONS, tp.seasons, { multiple: true });
      styles = chipGroup(STYLES, tp.styles, { multiple: true });
      seasonsSlot.replaceChildren(seasons);
      stylesSlot.replaceChildren(styles);
    };
    const paintTypes = () => {
      const list = SUBTYPES[category] || [];
      if (!list.length) { typesSlot.replaceChildren(); return; }
      const opts = Object.fromEntries(list.map((tp) => [tp.name, tp.name]));
      typesSlot.replaceChildren(h('div', { class: 'field' }, h('span', {}, 'Tipo'),
        chipGroup(opts, f.subcategory.value, { onChange: (v) => applyType(list.find((tp) => tp.name === v)) })));
    };
    const categoryChips = chipGroup(CATEGORIES, category, {
      onChange: (v) => { category = v; f.subcategory.value = ''; paintTypes(); paintMatch(); },
    });
    paintTypes();
    paintMatch();
    f.subcategory.addEventListener('input', paintMatch);

    // Seleziona categoria e tipo come se li avesse toccati l'utente.
    const chooseType = (cat, name) => {
      const ci = Object.keys(CATEGORIES).indexOf(cat);
      categoryChips.children[ci]?.click();
      const ti = (SUBTYPES[cat] || []).findIndex((tp) => tp.name === name);
      typesSlot.querySelector('.chips')?.children[ti]?.click();
    };

    // Riconoscimento del tipo di capo dalla foto, sul telefono.
    const runGarment = async () => {
      guessSlot.replaceChildren(h('div', { class: 'status' }, h('span', { class: 'spinner' }),
        isModelCached() ? 'Riconosco il capo…' : 'Riconosco il capo… (la prima volta scarico il modello, circa 12 MB)'));
      try {
        const { types: guesses, colors: hues, emb, learned } = await analyzeGarment(item.image, 4, { excludeId: item.id });
        lastEmb = emb;
        lastEmbImage = item.image;
        const [first, ...others] = guesses;
        chooseType(first.category, first.name);
        // Molto simile a un capo già salvato: si usa anche il nome che gli avevi dato tu.
        const same = learned && learned.item.category === first.category && learned.item.subcategory === first.name;
        if (same && learned.item.subcategory && !f.subcategory.value.trim()) f.subcategory.value = learned.item.subcategory;
        // Colore principale dal modello (non si lascia ingannare da luce e ombre), il secondo
        // dalla foto solo se è davvero diverso (non un'ombra dello stesso colore).
        if (hues[0]?.p >= 0.5 && colorsAuto) {
          await colorsDone;
          const main = hues[0].name;
          const far = (a, b) => labDistance(PALETTE[a], PALETTE[b]) > 35;
          const extra = f.colors.value.split(',').map((x) => x.trim()).filter((c) => PALETTE[c] && far(c, main));
          f.colors.value = [main, ...extra].slice(0, 2).join(', ');
          paintColorChips();
          paintMannequin();
          status.replaceChildren(h('p', { class: 'hint' }, `Colori riconosciuti: ${f.colors.value}.`));
        }
        const sure = first.p >= 0.5;
        guessSlot.replaceChildren(h('div', { class: 'field' },
          h('p', { class: 'hint' }, `${sure ? 'Mi sembra' : 'Forse è'}: ${articolo(first.name)} (${Math.round(first.p * 100)}%). Se non è giusto tocca un'altra ipotesi o scegli tu il tipo: me lo ricorderò per i capi simili.`),
          same ? h('p', { class: 'hint learned' }, `Somiglia a un capo che hai già salvato come ${articolo(first.name)}.`) : null,
          h('div', { class: 'chips' }, ...others.filter((g) => g.p >= 0.03).map((g) => h('button', {
            type: 'button', class: 'chip', onclick: () => { chooseType(g.category, g.name); },
          }, `${g.name} ${Math.round(g.p * 100)}%`)))));
      } catch (e) {
        console.warn('riconoscimento capo', e);
        guessSlot.replaceChildren(h('p', { class: 'hint' }, 'Non sono riuscito a riconoscere il capo (serve la rete la prima volta). Scegli tu categoria e tipo.'));
      }
    };

    const colorChips = h('div', { class: 'chips' });
    const paintColorChips = () => {
      const current = f.colors.value.split(',').map((x) => x.trim()).filter(Boolean);
      colorChips.replaceChildren(...Object.keys(PALETTE).map((name) => {
        const [r, g, b] = PALETTE[name];
        const on = current.includes(name);
        return h('button', {
          type: 'button', class: 'chip', 'aria-pressed': String(on),
          onclick: () => {
            const now = f.colors.value.split(',').map((x) => x.trim()).filter(Boolean);
            const next = now.includes(name) ? now.filter((c) => c !== name) : [...now, name];
            f.colors.value = next.join(', ');
            paintColorChips();
            paintMannequin();
          },
        }, h('span', { class: 'swatch', style: `background: rgb(${r},${g},${b})` }), name);
      }));
    };
    f.colors.addEventListener('input', () => { paintColorChips(); paintMannequin(); });
    f.pattern.addEventListener('change', () => { paintMatch(); });
    paintColorChips();

    // I colori si aggiornano da soli solo finché l'utente non li tocca.
    let colorsAuto = !(item.colors || []).length;
    let colorsDone = Promise.resolve();
    colorChips.addEventListener('click', () => { colorsAuto = false; });
    f.colors.addEventListener('input', () => { colorsAuto = false; });
    const runColors = async () => {
      status.replaceChildren(h('div', { class: 'status' }, h('span', { class: 'spinner' }), 'Riconosco i colori…'));
      try {
        const found = await detectColors(item.image);
        if (found.length) {
          f.colors.value = found.join(', ');
          paintColorChips();
          paintMannequin();
          status.replaceChildren(h('p', { class: 'hint' }, `Colori riconosciuti: ${found.join(', ')}.`));
        } else {
          status.replaceChildren(h('p', { class: 'hint' }, 'Scegli categoria, tipo e colori.'));
        }
      } catch {
        status.replaceChildren(h('p', { class: 'hint' }, 'Scegli categoria, tipo e colori.'));
      }
    };

    // ---------- sfondo ----------
    // Le due versioni della foto (con e senza sfondo) restano a portata finché la scheda è aperta.
    let withBg = item.cutout ? null : item.image;
    let noBg = item.cutout ? item.image : null;
    const setImage = (cut) => {
      item = { ...item, image: cut ? noBg : withBg, cutout: cut };
      photo.src = URL.createObjectURL(item.image);
      photo.className = cut ? 'preview cut' : 'preview';
      paintBgSlot();
      if (isNew) { colorsAuto = true; colorsDone = runColors(); runGarment(); }
    };
    const paintBgSlot = () => {
      const btn = (label, onclick) => h('button', { type: 'button', class: 'linkbtn', onclick }, label);
      bgSlot.replaceChildren(item.cutout
        ? (withBg ? btn('Rimetti lo sfondo', () => setImage(false)) : null)
        : btn('Togli lo sfondo', () => cutBackground(true)));
    };
    // Restituisce true se lo sfondo è stato tolto.
    const cutBackground = async (manual) => {
      if (!noBg) {
        bgSlot.replaceChildren(h('div', { class: 'status' }, h('span', { class: 'spinner' }), 'Tolgo lo sfondo…'));
        try {
          noBg = await removeBackground(withBg);
        } catch (e) {
          console.warn('sfondo', e);
          paintBgSlot();
          if (manual) toast('Non sono riuscito a togliere lo sfondo (serve la rete la prima volta).');
          return false;
        }
        if (!noBg) {
          paintBgSlot();
          if (manual) toast('Non riesco a staccare bene il capo dallo sfondo: tengo la foto com\'è.');
          return false;
        }
      }
      if (manual) setImage(true);
      else { item = { ...item, image: noBg, cutout: true }; photo.src = URL.createObjectURL(noBg); photo.className = 'preview cut'; paintBgSlot(); }
      return true;
    };
    paintBgSlot();

    // ---------- è davvero un capo? ----------
    // Foto nuova: prima di tutto si controlla (sul telefono) che sia un capo d'abbigliamento.
    // Una mappa, una schermata, un paesaggio… non si salvano.
    let garmentCheck = Promise.resolve(true);
    const checkGarment = async () => {
      status.replaceChildren(h('div', { class: 'status' }, h('span', { class: 'spinner' }),
        isModelCached() ? 'Controllo che sia un capo…' : 'Controllo che sia un capo… (la prima volta scarico il modello, circa 12 MB)'));
      let res;
      try {
        res = await analyzeGarment(withBg || item.image, 1);
      } catch (e) {
        console.warn('controllo capo', e);
        status.replaceChildren();
        return true; // senza modello (offline la prima volta) non si può controllare
      }
      status.replaceChildren();
      if (res.garment?.ok !== false) return true;
      const what = NOT_GARMENT[res.garment.other];
      wrap.replaceChildren(
        sheetHead('Foto non valida', close),
        h('div', { class: 'not-garment' },
          h('img', { class: 'preview', src: photo.src, alt: 'La foto scelta' }),
          h('div', { class: 'error-box' },
            h('strong', {}, 'Questa foto non è un capo d\'abbigliamento'),
            h('p', {}, `${what ? `Sembra ${what}. ` : ''}Non l'ho aggiunta all'armadio: carica la foto di una maglia, un pantalone, una giacca, delle scarpe o un accessorio.`)),
          h('div', { class: 'row end' },
            h('button', { class: 'btn', type: 'button', onclick: close }, 'Chiudi'),
            h('button', { class: 'btn primary', type: 'button', onclick: () => { close(); document.querySelector('.fab')?.click(); } }, 'Scegli un\'altra foto'))));
      return false;
    };

    const save = async () => {
      if (isNew && !(await garmentCheck)) return;
      if (!category) { toast('Scegli una categoria.'); return; }
      const updated = {
        ...item,
        category,
        subcategory: f.subcategory.value.trim(),
        colors: f.colors.value.split(',').map((s) => s.trim()).filter(Boolean),
        pattern: f.pattern.value,
        material: f.material.value.trim(),
        formality: Number(f.formality.value),
        seasons: seasons.value(),
        styles: styles.value(),
        brand: f.brand.value.trim(),
        size: f.size.value.trim(),
        notes: f.notes.value.trim(),
        image: item.image,
        cutout: !!item.cutout,
        per,
        updatedAt: new Date().toISOString(),
      };
      await db.put('items', updated);
      // L'app ricorda il tipo che hai scelto per questa foto e lo usa per i capi simili.
      const learnNow = async () => {
        if (!lastEmb || lastEmbImage !== item.image) lastEmb = null;
        if (lastEmb) await rememberGarment(updated, lastEmb);
        await learnFromWardrobe();
      };
      learnNow().catch(() => {});
      close();
      toast(isNew ? 'Capo aggiunto all\'armadio' : 'Modifiche salvate');
      renderWardrobe();
    };

    const del = async () => {
      if (!confirm('Eliminare questo capo dall\'armadio?')) return;
      await db.remove('items', item.id);
      forgetGarment(item.id).catch(() => {});
      close();
      toast('Capo eliminato');
      renderWardrobe();
    };

    wrap.append(...[
      sheetHead(isNew ? 'Nuovo capo' : 'Dettagli capo', close),
      preview,
      bgSlot,
      status,
      guessSlot,
      isNew ? null : wornTodayRow(item),
      h('div', { class: 'field' }, h('span', {}, 'Categoria'), categoryChips),
      typesSlot,
      field('Nome del capo', f.subcategory),
      matchSlot,
      h('div', { class: 'field' }, h('span', {}, 'Colori'), colorChips, f.colors),
      h('div', { class: 'two' }, field('Fantasia', f.pattern), field('Materiale', f.material)),
      field('Formalità', f.formality),
      h('div', { class: 'field' }, h('span', {}, 'Stagioni'), seasonsSlot),
      h('div', { class: 'field' }, h('span', {}, 'Stili'), stylesSlot),
      h('div', { class: 'field' }, h('span', {}, 'Armadio'), perChips,
        h('small', { class: 'hint' }, 'Il capo si vede e si usa solo nell\'armadio scelto (tasto ♂/♀ in alto). Con "Entrambi" sta in tutti e due.')),
      h('div', { class: 'two' }, field('Marca', f.brand), field('Taglia', f.size)),
      field('Note', f.notes),
      h('div', { class: 'row end' },
        isNew ? null : h('button', { class: 'btn danger', type: 'button', onclick: del }, 'Elimina'),
        isNew ? null : h('button', { class: 'btn', type: 'button', onclick: runColors }, 'Riconosci colori'),
        isNew ? null : h('button', { class: 'btn', type: 'button', onclick: runGarment }, 'Riconosci capo'),
        h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Salva')),
    ].filter(Boolean));
    if (isNew) {
      setTimeout(async () => {
        garmentCheck = checkGarment();
        if (!(await garmentCheck)) return;
        await cutBackground(false);
        colorsDone = runColors();
        runGarment();
      }, 0);
    }
    return wrap;
  });
}

// ---------- Outfit del giorno ----------

const outfitState = { mood: 'rilassato', occasion: 'tempo_libero', dressCode: 'libero', weather: null, weatherError: null, results: null };
// Umore, occasione e dress code dell'ultima volta: la pagina Outfit riparte da lì.
try { Object.assign(outfitState, JSON.parse(localStorage.getItem('menga-outfit-scelte') || '{}')); } catch { /* niente */ }
function rememberChoices() {
  const { mood, occasion, dressCode } = outfitState;
  try { localStorage.setItem('menga-outfit-scelte', JSON.stringify({ mood, occasion, dressCode })); } catch { /* niente */ }
}

// Riga "Dress code" con la spiegazione delle regole sotto. get/set leggono e scrivono la scelta.
function dressCodePicker(get, set, { onInvite } = {}) {
  const note = h('p', { class: 'hint dc-note' });
  const paintNote = () => {
    const dc = DRESS_CODES[get()] || DRESS_CODES.libero;
    note.replaceChildren(`${dc.icon} `, h('b', {}, dc.label), `: ${dc.text}`);
  };
  const labels = Object.fromEntries(Object.entries(DRESS_CODES).map(([k, v]) => [k, v.label]));
  let chips = chipGroup(labels, get(), { onChange: (v) => { set(v); paintNote(); } });
  const slot = h('div', {}, chips);
  paintNote();
  // Per aggiornare la riga da fuori (dopo aver letto un invito).
  const refresh = () => {
    chips = chipGroup(labels, get(), { onChange: (v) => { set(v); paintNote(); } });
    slot.replaceChildren(chips);
    paintNote();
  };
  const invite = onInvite ? h('button', { class: 'link-btn', type: 'button', onclick: () => openInvite(onInvite) }, '📩 Incolla un invito: lo leggo io') : null;
  return { nodes: [h('h2', {}, 'Dress code'), slot, note, invite], refresh };
}

// Incolli il testo di un invito o di un messaggio: l'app trova il dress code e l'occasione.
function openInvite(onFound) {
  openDialog((close) => {
    const area = h('textarea', { rows: 5, placeholder: 'es. "Vi aspettiamo al matrimonio di Anna e Marco, sabato alle 16. Dress code: cocktail"' });
    const msg = h('p', { class: 'hint' });
    const read = () => {
      const r = readInvite(area.value);
      if (!r) { msg.textContent = 'Non ho trovato un dress code in questo testo: sceglilo tu dalla lista.'; return; }
      onFound(r);
      close();
      toast(`Dress code ${DRESS_CODES[r.code].label} (ho letto "${r.word}")`);
    };
    const paste = navigator.clipboard?.readText ? h('button', { class: 'btn', type: 'button', onclick: async () => {
      try { area.value = await navigator.clipboard.readText(); } catch { toast('Incolla tu il testo nel riquadro.'); }
    } }, 'Incolla') : null;
    return h('div', { class: 'sheet' },
      sheetHead('Leggi un invito', close),
      h('p', { class: 'hint' }, 'Incolla il testo dell\'invito, della mail o del messaggio. Cerco parole come "cerimonia", "cocktail", "colloquio" o "smart casual" e scelgo il dress code. Non esce niente dal telefono.'),
      area, msg,
      h('div', { class: 'row end' }, paste, h('button', { class: 'btn primary', type: 'button', onclick: read }, 'Leggi')));
  });
}

async function renderOutfit() {
  titleEl.textContent = 'Outfit del giorno';
  view.replaceChildren();
  const items = await sectionItems();

  const fewItems = items.length < 4;

  const weatherBox = h('div', { class: 'card weather' });
  const cityForm = (label) => {
    const input = h('input', { type: 'text', placeholder: 'es. Milano', value: savedCity()?.name || '', 'aria-label': 'Città', enterkeyhint: 'search' });
    const save = async () => {
      if (!input.value.trim()) return;
      ok.disabled = true;
      try {
        await setCity(input.value);
        outfitState.weather = null;
        loadWeather();
      } catch (e) {
        toast(e.message);
        ok.disabled = false;
      }
    };
    const ok = h('button', { class: 'btn', type: 'button', onclick: save }, 'Usa');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    return h('div', { class: 'city-form' }, h('span', { class: 'hint' }, label), h('div', { class: 'row city-row' }, input, ok));
  };
  const paintWeather = () => {
    const w = outfitState.weather;
    weatherBox.classList.toggle('weather-ask', !w && Boolean(outfitState.weatherError));
    if (w) {
      const change = h('button', { class: 'link-btn', type: 'button', onclick: () => weatherBox.replaceChildren(cityForm('Scrivi la città per il meteo:'),
        savedCity() ? h('button', { class: 'link-btn', type: 'button', onclick: () => { forgetCity(); outfitState.weather = null; loadWeather(); } }, 'Usa la posizione del telefono') : null) },
      w.place || 'Cambia città');
      weatherBox.replaceChildren(h('b', {}, `${w.now}°`), h('span', { class: 'weather-txt' }, `${w.sky} · ${w.min}°/${w.max}° · pioggia ${w.rain}%`), change);
    } else if (outfitState.weatherError) {
      weatherBox.replaceChildren(cityForm(`Non ho la posizione (${outfitState.weatherError.toLowerCase()}). Scrivi la tua città e uso il suo meteo:`));
    } else {
      weatherBox.replaceChildren(h('span', { class: 'spinner' }), h('span', {}, 'Leggo il meteo…'));
    }
  };
  const loadWeather = async () => {
    outfitState.weatherError = null;
    paintWeather();
    try {
      outfitState.weather = await getWeather();
      // Le proposte fatte senza meteo si rifanno col meteo vero.
      if (outfitState.results && outfitState.noWeather && view.contains(resultsBox)) propose({ scroll: false });
    } catch (e) {
      outfitState.weatherError = e.message;
    }
    paintWeather();
  };

  const resultsBox = h('div');
  const extrasBox = h('div');
  const go = h('button', { class: 'btn primary block', type: 'button' }, 'Altre proposte');
  const more = h('button', { class: 'btn block more-ideas', type: 'button' }, '✨ 2 proposte fuori dal tuo armadio');
  // In fondo, a richiesta: 2 outfit con un capo che non hai o con i capi che ti mancano.
  more.addEventListener('click', async () => {
    more.disabled = true;
    try {
      const [profile, history] = await Promise.all([db.getKV('profile'), db.getAll('outfits')]);
      const args = {
        items, profile: sectionProfile(profile), history,
        mood: outfitState.mood, occasion: outfitState.occasion, dressCode: outfitState.dressCode,
        weather: outfitState.weather,
      };
      const extra = suggestOutfits({ ...args, fresh: true, count: 2 });
      if (extra.length < 2) {
        const taken = new Set(extra.map((o) => o.item_ids.join('|')));
        extra.push(...suggestOutfits({ ...args, count: 6 })
          .filter((o) => o.ideas.length && !taken.has(o.item_ids.join('|'))).slice(0, 2 - extra.length)
          .map((o) => ({ ...o, outside: true })));
      }
      outfitState.extras = extra;
      paintResults(extrasBox, items, extra);
      more.textContent = '✨ Altre 2 proposte fuori armadio';
      extrasBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      extrasBox.replaceChildren(h('p', { class: 'error' }, e.message));
    } finally {
      more.disabled = false;
    }
  });
  const propose = async ({ scroll = true } = {}) => {
    go.disabled = true;
    try {
      const [profile, history] = await Promise.all([db.getKV('profile'), db.getAll('outfits')]);
      history.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const args = {
        items, profile: sectionProfile(profile), history,
        mood: outfitState.mood, occasion: outfitState.occasion, dressCode: outfitState.dressCode,
        weather: outfitState.weather,
      };
      // Le 3 proposte usano solo i tuoi capi (con l'armadio vuoto, capi da prendere).
      outfitState.results = suggestOutfits({ ...args, ownOnly: items.length > 0 });
      outfitState.extras = null;
      extrasBox.replaceChildren();
      more.textContent = '✨ 2 proposte fuori dal tuo armadio';
      outfitState.noWeather = !outfitState.weather;
      outfitState.profile = sectionProfile(profile);
      paintResults(resultsBox, items);
      if (scroll) resultsBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      resultsBox.replaceChildren(h('p', { class: 'error' }, e.message));
    } finally {
      go.disabled = false;
    }
  };
  go.addEventListener('click', () => propose());

  // Outfit pianificato per oggi dal Diario.
  const planned = (await db.getAll('outfits')).find((o) => o.planned === todayKey() && !o.worn);
  let plannedCard = null;
  if (planned) {
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    const pieces = (planned.itemIds || []).map((id) => byId[id]).filter(Boolean);
    const wearBtn = h('button', {
      type: 'button', class: 'btn primary',
      onclick: async () => { await wearOutfit(planned, pieces); wearBtn.disabled = true; wearBtn.textContent = 'Indossato oggi ✓'; toast('Buona giornata!'); },
    }, 'Lo indosso oggi');
    plannedCard = h('div', { class: 'card outfit' },
      h('h3', {}, `Per oggi avevi scelto: ${planned.title || 'outfit'}`),
      pieces.length ? h('figure', { class: 'look' }, lookView(pieces, planned.occasion || 'tempo_libero')) : null,
      h('div', { class: 'row end' }, h('a', { class: 'btn', href: '#/diario' }, 'Diario'), wearBtn));
  }

  // Filtri chiusi in una riga: si vedono le scelte, si aprono a tocco e ogni cambio rifà le proposte.
  const summaryText = h('span', { class: 'filters-now' });
  const paintSummary = () => {
    const dc = DRESS_CODES[outfitState.dressCode];
    summaryText.textContent = [MOODS[outfitState.mood], OCCASIONS[outfitState.occasion],
      dc && outfitState.dressCode !== 'libero' ? dc.label : null].filter(Boolean).join(' · ');
  };
  const changed = () => { rememberChoices(); paintSummary(); propose({ scroll: false }); };
  const occasionChips = () => chipGroup(OCCASIONS, outfitState.occasion, { onChange: (v) => { outfitState.occasion = v; changed(); } });
  const occasionSlot = h('div', {}, occasionChips());
  const dcPicker = dressCodePicker(() => outfitState.dressCode, (v) => { outfitState.dressCode = v; changed(); }, {
    onInvite: (r) => {
      outfitState.dressCode = r.code;
      outfitState.occasion = r.occasion;
      occasionSlot.replaceChildren(occasionChips());
      dcPicker.refresh();
      changed();
    },
  });
  paintSummary();
  const filters = h('details', { class: 'card filters' },
    h('summary', {}, h('span', { class: 'filters-label' }, 'Umore e occasione'), summaryText),
    h('h2', {}, 'Come ti senti oggi?'),
    chipGroup(MOODS, outfitState.mood, { onChange: (v) => { outfitState.mood = v; changed(); } }),
    h('h2', {}, 'Per cosa ti vesti?'),
    occasionSlot,
    ...dcPicker.nodes);

  view.append(...[
    weatherBox,
    plannedCard,
    fewItems ? h('p', { class: 'hint' }, items.length
      ? 'Hai ancora pochi capi: dove manca qualcosa ti propongo io cosa prendere.'
      : 'L\'armadio è vuoto: intanto ti propongo outfit completi con capi da prendere. Più capi aggiungi, più le proposte useranno i tuoi.') : null,
    filters,
    go,
    h('div', { class: 'spacer' }),
    resultsBox,
    items.length ? extrasBox : null,
    items.length ? more : null,
  ].filter(Boolean));

  paintWeather();
  if (!outfitState.weather) loadWeather();
  // Le proposte arrivano subito, senza dover toccare niente.
  if (outfitState.results) {
    paintResults(resultsBox, items);
    if (outfitState.extras) paintResults(extrasBox, items, outfitState.extras);
  }
  else await propose({ scroll: false });
}

function paintResults(box, items, list = outfitState.results) {
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  box.replaceChildren();
  if (!list?.length) {
    box.append(h('p', { class: 'error' }, 'Nessuna proposta valida, riprova.'));
    return;
  }
  for (const o of list) {
    const record = {
      id: o.savedId || db.newId(),
      date: new Date().toISOString(),
      title: o.title, reason: o.reason, itemIds: o.item_ids,
      mood: outfitState.mood, occasion: outfitState.occasion, dressCode: o.dressCode?.key || null,
      weather: outfitState.weather?.summary || null,
      rating: o.rating || null, worn: Boolean(o.worn),
    };
    const persist = async () => { o.savedId = record.id; await db.put('outfits', record); };

    const up = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(o.rating === 'up') }, '👍 Mi piace');
    const down = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(o.rating === 'down') }, '👎 No');
    const rate = async (r) => {
      o.rating = record.rating = o.rating === r ? null : r;
      up.setAttribute('aria-pressed', String(o.rating === 'up'));
      down.setAttribute('aria-pressed', String(o.rating === 'down'));
      await persist();
    };
    up.addEventListener('click', () => rate('up'));
    down.addEventListener('click', () => rate('down'));

    const wear = h('button', { class: 'btn primary', type: 'button', disabled: o.worn }, o.worn ? 'Indossato oggi ✓' : 'Lo indosso oggi');
    wear.addEventListener('click', async () => {
      o.worn = record.worn = true;
      if (!o.rating) o.rating = record.rating = 'up';
      const now = new Date().toISOString();
      for (const id of o.item_ids) {
        const it = byId[id];
        if (!it) continue;
        it.timesWorn = (it.timesWorn || 0) + 1;
        it.lastWorn = now;
        await db.put('items', it);
      }
      await persist();
      wear.disabled = true;
      wear.textContent = 'Indossato oggi ✓';
      up.setAttribute('aria-pressed', String(o.rating === 'up'));
      toast('Buona giornata!');
    });

    box.append(h('div', { class: o.fresh || o.outside ? 'card outfit fresh' : 'card outfit' },
      o.fresh || o.outside ? h('p', { class: 'fresh-tag' }, '✨ Fuori dal tuo armadio') : null,
      h('h3', {}, o.title),
      dressCodeBadge(o),
      h('p', {}, o.reason),
      lookBox(o.pieces.map((p) => byId[p.id] || p)),
      h('div', { class: 'pieces' }, o.pieces.map((p) => {
        const it = byId[p.id] || p;
        if (it.idea) {
          const rgb = PALETTE[it.colors[0]] || [200, 200, 200];
          const light = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11 > 150;
          return h('figure', {}, h('div', { class: 'idea-tile', style: `background:rgb(${rgb.join(',')});color:${light ? '#1f1d1a' : '#fff'}` },
            h('span', {}, it.subcategory), h('small', {}, it.colors[0])), h('figcaption', {}, 'Da prendere'));
        }
        return h('figure', {}, h('img', { src: imgURL(it), alt: describeItem(it), class: it.cutout ? 'cut' : null }), h('figcaption', {}, it.subcategory || CATEGORIES[it.category]));
      })),
      o.ideas.length ? h('div', { class: 'missing' },
        h('span', {}, o.fresh ? 'Il capo nuovo: ' : o.ideas.length === o.pieces.length ? 'Capi da prendere: ' : 'Per completarlo ti manca: '),
        ...o.ideas.flatMap((it, i) => [i ? ', ' : null,
          h('a', { href: shopLink(it), target: '_blank', rel: 'noopener' }, ideaName(it))].filter(Boolean)),
        h('span', {}, ' (tocca per cercarlo online)')) : null,
      h('div', { class: 'row' }, up, down, h('span', { style: 'flex:1' }), o.fresh || o.outside || o.ideas.length === o.pieces.length ? null : wear)));
  }
}

// Sotto il titolo: se l'outfit rispetta il dress code scelto, o cosa manca per rispettarlo.
function dressCodeBadge(o) {
  const dc = o.dressCode;
  if (!dc) return null;
  return o.ideas.length
    ? h('p', { class: 'dc-badge warn' }, `${dc.icon} Per il dress code `, h('b', {}, dc.label), ' ti manca qualcosa: guarda i capi da prendere qui sotto.')
    : h('p', { class: 'dc-badge ok' }, '✓ Rispetta il dress code ', h('b', {}, dc.label), `: ${dc.check}.`);
}

// Anteprima: il manichino con i colori dei capi proposti, disegnato subito sul telefono.
// Vestibilità e budget del profilo (questionario iniziale) per i link di acquisto.
const FITS = { aderente: 'Aderente', regolare: 'Regolare', comoda: 'Comoda / oversize' };
const FIT_QUERY = { aderente: 'slim fit', comoda: 'oversize' };
const BUDGETS = {
  'fino a 30 € a capo': '€ · fino a 30',
  '30–80 € a capo': '€€ · 30–80',
  '80–150 € a capo': '€€€ · 80–150',
  'oltre 150 € a capo': '€€€€ · oltre 150',
};
const BUDGET_RANGE = { 'fino a 30 € a capo': [0, 30], '30–80 € a capo': [30, 80], '80–150 € a capo': [80, 150], 'oltre 150 € a capo': [150, 0] };
function shopSearch(name, category, profile) {
  const p = profile || {};
  const gender = { uomo: 'uomo', donna: 'donna' }[p.gender] || '';
  const size = category === 'shoes' ? p.shoe : category === 'bottom' ? p.bottomSize : category === 'accessory' ? '' : p.topSize;
  const fit = ['shoes', 'accessory'].includes(category) ? '' : FIT_QUERY[p.fit] || '';
  const q = [name, gender, fit, size ? `taglia ${size}` : ''].filter(Boolean).join(' ');
  const range = BUDGET_RANGE[p.budget];
  const price = range ? `&tbs=mr:1,price:1${range[0] ? `,ppr_min:${range[0]}` : ''}${range[1] ? `,ppr_max:${range[1]}` : ''}` : '';
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(q)}${price}`;
}

function lookBox(pieces) {
  return h('figure', { class: 'look' }, lookView(pieces, outfitState.occasion), h('figcaption', {}, 'Anteprima dell\'outfit sul manichino'));
}

// Ricerca del capo online con la taglia, la vestibilità e il budget del profilo.
function shopLink(it) {
  return shopSearch(ideaName(it), it.category, outfitState.profile);
}
// ---------- Diario: calendario degli outfit e statistiche ----------

const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayKey = () => dayKey(new Date());
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
// Giorno di un outfit: quello pianificato, altrimenti il giorno in cui l'hai indossato.
const outfitDay = (o) => o.planned || (o.date ? dayKey(new Date(o.date)) : '');
const WEEKDAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const skyIcon = (sky) => ({ sereno: '☀️', 'poco nuvoloso': '🌤️', nuvoloso: '☁️', nebbia: '🌫️', pioviggine: '🌦️', pioggia: '🌧️', neve: '❄️', temporale: '⛈️' }[sky] || '🌡️');

const diaryState = { tab: null, month: null, forecast: null, forecastError: null };

async function renderDiary() {
  titleEl.textContent = 'Diario';
  view.replaceChildren();
  if (!diaryState.tab) {
    try { diaryState.tab = localStorage.getItem('menga-diario') || 'calendario'; } catch { diaryState.tab = 'calendario'; }
  }
  // Il calendario mostra tutti gli outfit passati; statistiche e proposte guardano la sezione aperta.
  const [items, outfits] = await Promise.all([db.getAll('items'), db.getAll('outfits'), loadProfileGender()]);
  const body = h('div');
  const tabs = chipGroup({ calendario: 'Calendario', statistiche: 'Statistiche' }, diaryState.tab, {
    onChange: (v) => {
      diaryState.tab = v;
      try { localStorage.setItem('menga-diario', v); } catch { /* niente */ }
      paint();
    },
  });
  const paint = () => body.replaceChildren(diaryState.tab === 'statistiche' ? statsView(items.filter(inSection), outfits) : calendarView(items, outfits));
  view.append(tabs, body);
  paint();
}

// Piccola fila di colori dei capi di un outfit.
function outfitDots(o, byId) {
  return h('span', { class: 'odots' }, (o.itemIds || []).map((id) => byId[id]).filter(Boolean).slice(0, 4).map((it) => {
    const rgb = PALETTE[it.colors?.[0]] || [150, 150, 150];
    return h('i', { style: `background:rgb(${rgb.join(',')})` });
  }));
}

function calendarView(items, outfits) {
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const shown = outfits.filter((o) => o.worn || o.planned);
  const byDay = {};
  for (const o of shown) (byDay[outfitDay(o)] ||= []).push(o);
  const box = h('div');

  // Settimana: meteo e outfit pianificati.
  const week = h('div', { class: 'week' });
  const paintWeek = () => {
    const days = [];
    for (let i = 0; i < 7; i++) { const d = new Date(); d.setDate(d.getDate() + i); days.push(d); }
    week.replaceChildren(...days.map((d, i) => {
      const k = dayKey(d);
      const fc = diaryState.forecast?.find((f) => f.day === k);
      const list = byDay[k] || [];
      const plan = list.find((o) => o.planned && !o.worn);
      const worn = list.find((o) => o.worn);
      return h('div', { class: 'wday' + (i === 0 ? ' today' : '') },
        h('b', {}, i === 0 ? 'Oggi' : i === 1 ? 'Domani' : `${WEEKDAYS[d.getDay()]} ${d.getDate()}`),
        h('span', { class: 'wsky' }, fc ? `${skyIcon(fc.sky)} ${fc.min}°/${fc.max}°` : diaryState.forecastError ? '' : '…'),
        fc && fc.rain >= 50 ? h('small', {}, `pioggia ${fc.rain}%`) : null,
        worn ? h('button', { type: 'button', class: 'wplan done', onclick: () => openDay(k, items, outfits) }, outfitDots(worn, byId), 'Indossato')
          : plan ? h('button', { type: 'button', class: 'wplan', onclick: () => openDay(k, items, outfits) }, outfitDots(plan, byId), plan.title || 'Pianificato')
            : h('button', { type: 'button', class: 'wplan empty', onclick: () => planDay(k, fc, items) }, '+ Pianifica'));
    }));
  };
  paintWeek();
  if (!diaryState.forecast && !diaryState.forecastError) {
    getForecast(7).then((f) => { diaryState.forecast = f; paintWeek(); })
      .catch((e) => { diaryState.forecastError = e.message; paintWeek(); });
  }

  // Mese.
  const now = new Date();
  if (!diaryState.month) diaryState.month = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthBox = h('div');
  const paintMonth = () => {
    const m = diaryState.month;
    const first = new Date(m.getFullYear(), m.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // da lunedì
    const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'cday blank' }));
    let wornCount = 0;
    for (let d = 1; d <= daysIn; d++) {
      const k = dayKey(new Date(m.getFullYear(), m.getMonth(), d));
      const list = byDay[k] || [];
      const o = list.find((x) => x.worn) || list[0];
      if (list.some((x) => x.worn)) wornCount++;
      cells.push(h('button', {
        type: 'button', class: 'cday' + (k === todayKey() ? ' today' : '') + (o ? (o.worn ? ' worn' : ' planned') : ''),
        onclick: () => (o ? openDay(k, items, outfits) : k >= todayKey() ? planDay(k, diaryState.forecast?.find((f) => f.day === k), items) : null),
      }, h('span', {}, d), o ? outfitDots(o, byId) : null));
    }
    const move = (n) => { diaryState.month = new Date(m.getFullYear(), m.getMonth() + n, 1); paintMonth(); };
    monthBox.replaceChildren(
      h('div', { class: 'mhead' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mese prima', onclick: () => move(-1) }, '‹'),
        h('b', {}, `${MONTHS[m.getMonth()]} ${m.getFullYear()}`),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mese dopo', onclick: () => move(1) }, '›')),
      h('div', { class: 'cal' }, ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'].map((w) => h('span', { class: 'cwd' }, w)), cells),
      h('p', { class: 'hint' }, wornCount ? `${wornCount} ${wornCount === 1 ? 'giorno' : 'giorni'} con un outfit indossato in questo mese.` : 'In questo mese non hai ancora segnato outfit. Quando tocchi "Lo indosso oggi" finiscono qui.'));
  };
  paintMonth();

  box.append(
    h('h2', {}, 'La tua settimana'),
    h('p', { class: 'hint' }, diaryState.forecastError ? `Meteo non disponibile (${diaryState.forecastError}): puoi pianificare lo stesso.` : 'Pianifica gli outfit col meteo dei prossimi giorni.'),
    week,
    h('h2', {}, 'Calendario'),
    monthBox);
  return box;
}

// Giorno del calendario: gli outfit indossati o pianificati, con anteprima.
function openDay(k, items, outfits) {
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const list = outfits.filter((o) => (o.worn || o.planned) && outfitDay(o) === k);
  const d = fromKey(k);
  openDialog((close) => h('div', { class: 'sheet' },
    sheetHead(`${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`, close),
    ...list.map((o) => {
      const pieces = (o.itemIds || []).map((id) => byId[id]).filter(Boolean);
      const isToday = k === todayKey();
      return h('div', { class: 'card outfit' },
        h('h3', {}, o.title || 'Outfit'),
        h('p', { class: 'hint' }, o.worn ? 'Indossato' : 'Pianificato', o.weather ? ` · ${o.weather}` : ''),
        pieces.length ? h('figure', { class: 'look' }, lookView(pieces, o.occasion || 'tempo_libero')) : null,
        h('div', { class: 'pieces' }, pieces.map((it) => h('figure', {}, h('img', { src: imgURL(it), alt: describeItem(it), class: it.cutout ? 'cut' : null }), h('figcaption', {}, it.subcategory || CATEGORIES[it.category])))),
        h('div', { class: 'row end' },
          h('button', {
            type: 'button', class: 'btn danger',
            onclick: async () => {
              if (!confirm(o.worn ? 'Togliere questo outfit dal calendario?' : 'Togliere questo outfit pianificato?')) return;
              if (o.worn) {
                for (const it of pieces) { it.timesWorn = Math.max(0, (it.timesWorn || 0) - 1); await db.put('items', it); }
              }
              await db.remove('outfits', o.id);
              close();
              toast('Tolto dal calendario');
              route();
            },
          }, 'Togli'),
          !o.worn && isToday ? h('button', {
            type: 'button', class: 'btn primary',
            onclick: async () => { await wearOutfit(o, pieces); close(); toast('Buona giornata!'); route(); },
          }, 'Lo indosso oggi') : null));
    })));
}

// Segna un outfit come indossato oggi: conta per i capi e finisce nel calendario.
async function wearOutfit(record, pieces) {
  const now = new Date().toISOString();
  for (const it of pieces) {
    if (it.idea) continue;
    it.timesWorn = (it.timesWorn || 0) + 1;
    it.lastWorn = now;
    await db.put('items', it);
  }
  record.worn = true;
  record.date = now;
  if (!record.rating) record.rating = 'up';
  await db.put('outfits', record);
}

// Il capo nel diario di oggi: tutti i capi segnati lo stesso giorno finiscono nello stesso outfit.
async function todayWornOutfit() {
  const k = todayKey();
  const list = (await db.getAll('outfits')).filter((o) => o.worn && outfitDay(o) === k);
  return list.find((o) => o.manual) || list[0] || null;
}

// Riga nei dettagli del capo: quante volte l'hai messo e il tasto "Lo indosso oggi" (ritocco = annulla).
function wornTodayRow(item) {
  const stat = h('p', { class: 'stat' });
  const btn = h('button', { type: 'button', class: 'btn primary wear-today' });
  let wornToday = false;
  const paint = () => {
    stat.textContent = item.timesWorn
      ? `Indossato ${item.timesWorn} ${item.timesWorn === 1 ? 'volta' : 'volte'}, l'ultima il ${new Date(item.lastWorn).toLocaleDateString('it-IT')}`
      : 'Mai indossato finora';
    btn.textContent = wornToday ? '✓ Lo indossi oggi' : '👕 Lo indosso oggi';
    btn.classList.toggle('on', wornToday);
    btn.setAttribute('aria-pressed', String(wornToday));
  };
  todayWornOutfit().then((o) => { wornToday = !!o?.itemIds?.includes(item.id); paint(); }).catch(() => {});
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const now = new Date().toISOString();
      let o = await todayWornOutfit();
      if (!wornToday) {
        if (!o) {
          o = { id: db.newId(), date: now, title: 'Indossati oggi', reason: '', itemIds: [], mood: null, occasion: null, dressCode: null, weather: null, rating: null, worn: true, manual: true };
        }
        if (!o.itemIds.includes(item.id)) o.itemIds.push(item.id);
        await db.put('outfits', o);
        item.timesWorn = (item.timesWorn || 0) + 1;
        item.lastWorn = now;
        await db.put('items', item);
        wornToday = true;
        toast('Segnato nel diario di oggi');
      } else {
        if (o) {
          o.itemIds = (o.itemIds || []).filter((id) => id !== item.id);
          if (!o.itemIds.length && o.manual) await db.remove('outfits', o.id);
          else await db.put('outfits', o);
        }
        item.timesWorn = Math.max(0, (item.timesWorn || 0) - 1);
        if (!item.timesWorn) item.lastWorn = null;
        await db.put('items', item);
        wornToday = false;
        toast('Tolto dal diario di oggi');
      }
      paint();
    } finally {
      btn.disabled = false;
    }
  });
  paint();
  return h('div', { class: 'wear-row' }, stat, btn);
}

// Pianifica un giorno: scegli occasione e umore, l'app propone 3 outfit col meteo di quel giorno.
function planDay(k, fc, items) {
  const d = fromKey(k);
  let occasion = outfitState.occasion;
  let mood = outfitState.mood;
  let dressCode = outfitState.dressCode;
  openDialog((close) => {
    const occSlot = h('div');
    const paintOcc = () => occSlot.replaceChildren(chipGroup(OCCASIONS, occasion, { onChange: (v) => { occasion = v; } }));
    paintOcc();
    const planDc = dressCodePicker(() => dressCode, (v) => { dressCode = v; }, {
      onInvite: (r) => { dressCode = r.code; occasion = r.occasion; paintOcc(); planDc.refresh(); },
    });
    const results = h('div');
    const go = async () => {
      const [profile, history] = await Promise.all([db.getKV('profile'), db.getAll('outfits')]);
      const list = suggestOutfits({ items: items.filter(inSection), profile: sectionProfile(profile), history, mood, occasion, dressCode, weather: fc || null });
      results.replaceChildren(...list.map((o) => {
        const pieces = o.pieces;
        const usable = o.ideas.length < o.pieces.length;
        return h('div', { class: 'card outfit' },
          h('h3', {}, o.title),
          dressCodeBadge(o),
          h('p', {}, o.reason),
          h('figure', { class: 'look' }, lookView(pieces, occasion)),
          o.ideas.length ? h('p', { class: 'hint' }, `Ti manca: ${o.ideas.map(ideaName).join(', ')}`) : null,
          usable ? h('div', { class: 'row end' }, h('button', {
            type: 'button', class: 'btn primary',
            onclick: async () => {
              await db.put('outfits', {
                id: db.newId(), date: new Date().toISOString(), planned: k,
                title: o.title, reason: o.reason, itemIds: o.item_ids.filter((id) => items.some((it) => it.id === id)),
                mood, occasion, dressCode: o.dressCode?.key || null, weather: fc?.summary || null, rating: null, worn: false,
              });
              close();
              toast('Outfit pianificato');
              route();
            },
          }, 'Scelgo questo')) : null);
      }));
    };
    return h('div', { class: 'sheet' },
      sheetHead(`Pianifica ${WEEKDAYS[d.getDay()]} ${d.getDate()}`, close),
      fc ? h('p', { class: 'hint' }, `${skyIcon(fc.sky)} ${fc.sky}, ${fc.min}°/${fc.max}°, pioggia ${fc.rain}%`) : null,
      h('h2', {}, 'Per cosa ti vesti?'),
      occSlot,
      h('h2', {}, 'Come vorresti sentirti?'),
      chipGroup(MOODS, mood, { onChange: (v) => { mood = v; } }),
      ...planDc.nodes,
      h('button', { type: 'button', class: 'btn primary block', onclick: go }, 'Proponimi 3 outfit'),
      h('div', { class: 'spacer' }),
      results);
  });
}

// ---------- statistiche ----------

const DAY_MS = 86400000;
const daysAgo = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS) : Infinity);

// Cosa manca all'armadio per vestirsi bene in ogni occasione e stagione.
function wardrobeGaps(items, profile) {
  const has = (cat, names) => items.some((it) => it.category === cat && (!names || names.includes(it.subcategory)));
  const donna = currentGender() === 'donna';
  const gaps = [];
  const add = (cond, text, idea) => { if (cond) gaps.push({ text, idea }); };
  add(!has('top'), 'Nessuna maglia o camicia.', { category: 'top', subcategory: 'T-shirt', colors: ['bianco'] });
  add(!has('bottom') && !has('dress'), 'Nessun pantalone.', { category: 'bottom', subcategory: 'Jeans', colors: ['denim'] });
  add(!has('shoes'), 'Nessuna scarpa.', { category: 'shoes', subcategory: 'Sneakers', colors: ['bianco'] });
  add(has('shoes') && !has('shoes', donna ? ['Scarpe eleganti', 'Mocassini', 'Décolleté'] : ['Scarpe eleganti', 'Mocassini']),
    'Nessuna scarpa elegante per lavoro ed eventi.', { category: 'shoes', subcategory: donna ? 'Décolleté' : 'Scarpe eleganti', colors: ['nero'] });
  add(!has('top', ['Camicia', 'Camicia elegante', 'Camicetta']), 'Nessuna camicia per il lavoro.', { category: 'top', subcategory: 'Camicia', colors: ['azzurro'] });
  add(!has('bottom', ['Pantaloni eleganti', 'Chino', 'Gonna']) && !has('dress'), 'Nessun pantalone elegante.', { category: 'bottom', subcategory: 'Chino', colors: ['blu navy'] });
  add(!has('outerwear', ['Cappotto', 'Piumino']), 'Nessun capo caldo per l\'inverno.', { category: 'outerwear', subcategory: 'Cappotto', colors: ['blu navy'] });
  add(!has('outerwear', ['Impermeabile', 'Trench']), 'Niente per la pioggia.', { category: 'outerwear', subcategory: 'Impermeabile', colors: ['nero'] });
  add(!has('shoes', ['Scarpe da corsa']) && !has('bottom', ['Pantaloni sportivi', 'Leggings']), 'Niente per lo sport.', { category: 'shoes', subcategory: 'Scarpe da corsa', colors: ['nero'] });
  add(!items.some((it) => ['top'].includes(it.category) && ['bianco', 'nero', 'grigio', 'grigio chiaro'].includes(it.colors?.[0])),
    'Nessuna maglia neutra (bianca, nera o grigia), la più facile da abbinare.', { category: 'top', subcategory: 'T-shirt', colors: ['bianco'] });
  // Colori del profilo: mai un colore da evitare; se possibile uno che ami tra quelli adatti.
  const list = (v) => String(v || '').toLowerCase().split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
  const avoid = list(profile?.avoidColors);
  const liked = list(profile?.likedColors);
  const neutral = ['nero', 'blu navy', 'grigio', 'bianco', 'beige', 'marrone'];
  const ok = (x) => !avoid.includes(x);
  for (const g of gaps) {
    const c = g.idea.colors[0];
    const cands = /neutra/.test(g.text) ? ['bianco', 'nero', 'grigio', 'grigio chiaro'] : [c, ...neutral];
    const pick = liked.find((x) => cands.includes(x) && ok(x)) || (ok(c) ? c : cands.find(ok)) || c;
    g.idea = { ...g.idea, colors: [pick] };
  }
  return gaps;
}

function gapLink(idea, profile) {
  return shopSearch(`${idea.subcategory} ${idea.colors[0]}`, idea.category, profile);
}

function statsView(items, outfits) {
  const box = h('div');
  if (!items.length) {
    box.append(h('p', { class: 'hint' }, 'Aggiungi qualche capo all\'armadio per vedere le statistiche.'));
    return box;
  }
  const worn = items.filter((i) => i.timesWorn);
  const never = items.filter((i) => !i.timesWorn);
  const top = [...worn].sort((a, b) => (b.timesWorn || 0) - (a.timesWorn || 0)).slice(0, 5);
  const forgotten = worn.filter((i) => daysAgo(i.lastWorn) >= 60).sort((a, b) => daysAgo(b.lastWorn) - daysAgo(a.lastWorn));
  const monthStart = new Date(); monthStart.setDate(1);
  const wornMonth = outfits.filter((o) => o.worn && o.date && new Date(o.date) >= new Date(monthStart.getFullYear(), monthStart.getMonth(), 1)).length;
  const strip = (list, label) => h('div', { class: 'strip' }, list.map((it) => h('button', { type: 'button', class: 'stile', onclick: () => editItem(it) },
    h('img', { src: imgURL(it), alt: describeItem(it), class: it.cutout ? 'cut' : null }), h('small', {}, label(it)))));

  // Capi per categoria.
  const cats = Object.keys(CATEGORIES).map((c) => [c, items.filter((i) => i.category === c).length]).filter(([, n]) => n);
  const maxCat = Math.max(...cats.map(([, n]) => n));
  // Colori principali.
  const colorCount = {};
  for (const it of items) { const c = it.colors?.[0]; if (c) colorCount[c] = (colorCount[c] || 0) + 1; }
  const colors = Object.entries(colorCount).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const gapsBox = h('div', { class: 'gaps' });
  db.getKV('profile').then((profile) => {
    const gaps = wardrobeGaps(items, sectionProfile(profile));
    gapsBox.replaceChildren(gaps.length
      ? h('ul', {}, gaps.map((g) => h('li', {}, g.text, ' ', h('a', { href: gapLink(g.idea, sectionProfile(profile)), target: '_blank', rel: 'noopener' }, `Cerca ${g.idea.subcategory.toLowerCase()} ${g.idea.colors[0]}`))))
      : h('p', { class: 'hint' }, 'Hai tutto il necessario per ogni occasione. 👌'));
  });

  box.append(
    h('div', { class: 'kpis' },
      h('div', {}, h('b', {}, items.length), h('span', {}, 'capi')),
      h('div', {}, h('b', {}, `${Math.round((worn.length / items.length) * 100)}%`), h('span', {}, 'indossati almeno una volta')),
      h('div', {}, h('b', {}, wornMonth), h('span', {}, 'outfit questo mese'))),
    h('h2', {}, 'Cosa ti manca'),
    gapsBox,
    never.length ? h('h2', {}, `Mai indossati (${never.length})`) : null,
    never.length ? strip(never, (it) => it.subcategory || CATEGORIES[it.category]) : null,
    top.length ? h('h2', {}, 'I più usati') : null,
    top.length ? strip(top, (it) => `${it.timesWorn} ${it.timesWorn === 1 ? 'volta' : 'volte'}`) : null,
    forgotten.length ? h('h2', {}, 'Dimenticati da più di 2 mesi') : null,
    forgotten.length ? strip(forgotten, (it) => `${daysAgo(it.lastWorn)} giorni fa`) : null,
    h('h2', {}, 'Per categoria'),
    h('div', { class: 'bars' }, cats.map(([c, n]) => h('div', { class: 'bar' },
      h('span', {}, CATEGORIES[c]), h('i', { style: `width:${Math.max(6, (n / maxCat) * 100)}%` }), h('b', {}, n)))),
    h('h2', {}, 'I tuoi colori'),
    h('div', { class: 'chips' }, colors.map(([c, n]) => {
      const rgb = PALETTE[c] || [150, 150, 150];
      return h('span', { class: 'chip' }, h('span', { class: 'swatch', style: `background: rgb(${rgb.join(',')})` }), `${c} ${n}`);
    })),
  );
  return box;
}

// ---------- Profilo ----------

async function renderProfile() {
  titleEl.textContent = 'Profilo';
  const p = (await db.getKV('profile')) || {};
  const items = await sectionItems();
  const outfits = await db.getAll('outfits').catch(() => []);
  view.replaceChildren();

  const num = (key, ph) => h('input', { type: 'number', inputmode: 'numeric', value: p[key] || '', placeholder: ph });
  const text = (key, ph) => h('input', { type: 'text', value: p[key] || '', placeholder: ph });
  const f = {
    height: num('height', 'cm'),
    weight: num('weight', 'kg'),
    chest: num('chest', 'cm'),
    waist: num('waist', 'cm'),
    hips: num('hips', 'cm'),
    shoe: text('shoe', 'es. 43'),
    topSize: text('topSize', 'es. M'),
    bottomSize: text('bottomSize', 'es. 48 o W32 L32'),
    brandSizes: h('textarea', { placeholder: 'Una per riga, es.\nZara: M\nUniqlo: L' }, p.brandSizes || ''),
    notes: h('textarea', { placeholder: 'es. preferisco vestiti comodi, non amo le cravatte' }, p.notes || ''),
  };
  // Valori scelti coi chip: si salvano come prima (testo), così lo stylist li legge uguale.
  let gender = p.gender || '';
  let budget = p.budget || '';
  const split = (v) => String(v || '').toLowerCase().split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
  const liked = new Set(split(p.likedColors));
  const avoid = new Set(split(p.avoidColors));
  // Colori scritti a mano che non sono nella tavolozza: si tengono.
  const extraLiked = [...liked].filter((c) => !PALETTE[c]);
  const extraAvoid = [...avoid].filter((c) => !PALETTE[c]);

  const status = h('span', { class: 'save-state' });
  const bar = h('i');
  const pct = h('strong');
  let timer = 0;
  const collect = () => {
    const out = { ...p, styles: styles.value(), gender, budget, fit, occasions: occasions.value(),
      likedColors: [...liked].join(', '), avoidColors: [...avoid].join(', ') };
    for (const [k, el] of Object.entries(f)) out[k] = el.value.trim();
    return out;
  };
  const paintProgress = () => {
    const o = collect();
    const keys = ['gender', 'height', 'weight', 'shoe', 'topSize', 'bottomSize', 'fit', 'styles', 'occasions', 'likedColors', 'budget', 'chest', 'waist'];
    const done = keys.filter((k) => (Array.isArray(o[k]) ? o[k].length : o[k])).length;
    const v = Math.round((done / keys.length) * 100);
    bar.style.width = `${v}%`;
    pct.textContent = `${v}%`;
  };
  const save = () => {
    paintProgress();
    // Salvataggio subito a ogni modifica: niente da perdere se si cambia scheda.
    const mine = ++timer;
    db.setKV('profile', collect()).then(() => { if (mine === timer) status.textContent = 'Salvato ✓'; });
  };
  for (const el of Object.values(f)) el.addEventListener('input', save);

  const genderChips = chipGroup(SECTION_LABELS, gender, {
    onChange: (v) => {
      gender = v;
      profileGender = v;
      // Decide solo dove vanno i capi: tema e manichino si cambiano col tasto ♂/♀ in alto.
      db.setKV('profile', collect()).then(route);
    },
  });
  const styles = chipGroup(STYLES, p.styles, { multiple: true, onChange: save });
  const sizeChips = (input, sizes) => chipGroup(Object.fromEntries(sizes.map((x) => [x, x])), input.value, {
    onChange: (v) => { input.value = v; save(); },
  });
  const budgetChips = chipGroup(BUDGETS, budget, { onChange: (v) => { budget = v; save(); } });
  let fit = p.fit || '';
  const fitChips = chipGroup(FITS, fit, { onChange: (v) => { fit = v; save(); } });
  const occasions = chipGroup(OCCASIONS, p.occasions, { multiple: true, onChange: save });

  const colorWrap = h('div');
  const paintColors = () => {
    const row = (set, other, extra) => h('div', { class: 'chips swatches' }, Object.keys(PALETTE).map((name) => {
      const [r, g, b] = PALETTE[name];
      return h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(set.has(name)), title: name,
        onclick: () => {
          if (set.has(name)) set.delete(name); else { set.add(name); other.delete(name); }
          paintColors();
          save();
        },
      }, h('span', { class: 'swatch', style: `background: rgb(${r},${g},${b})` }), name);
    }), extra.map((x) => h('span', { class: 'chip', 'aria-pressed': 'true' }, x)));
    colorWrap.replaceChildren(
      h('div', { class: 'field' }, h('span', {}, 'Colori che ami'), row(liked, avoid, extraLiked)),
      h('div', { class: 'field' }, h('span', {}, 'Colori da evitare'), row(avoid, liked, extraAvoid)),
    );
  };
  paintColors();

  const worn = items.filter((i) => i.timesWorn).length;
  const wornOutfits = outfits.filter((o) => o.worn).length;
  const section = (title, hint, ...body) => h('section', { class: 'card profile-sec' },
    h('h2', {}, title), hint ? h('p', { class: 'hint' }, hint) : null, ...body);

  view.append(
    h('div', { class: 'card profile-head' },
      h('div', { class: 'profile-stats' },
        h('div', {}, h('b', {}, String(items.length)), h('small', {}, 'capi')),
        h('div', {}, h('b', {}, String(worn)), h('small', {}, 'indossati')),
        h('div', {}, h('b', {}, String(wornOutfits)), h('small', {}, 'outfit'))),
      h('div', { class: 'profile-progress' },
        h('div', { class: 'row' }, h('span', {}, 'Profilo completo al ', pct), status),
        h('div', { class: 'meter' }, bar),
        h('p', { class: 'hint' }, 'Più lo completi, più gli outfit e i link per comprare sono su misura per te. Si salva da solo.'))),
    section('Il tuo stile di abiti', 'Che vestiti porti? Non conta chi sei, solo i capi che ti piace indossare.', genderChips,
      h('p', { class: 'hint' }, 'Decide in quale armadio vanno i capi nuovi. Quelli già caricati restano dove sono: per spostarne uno aprilo e cambia "Armadio".')),
    section('Taglie', 'Servono per cercare online i capi nella tua taglia.',
      field('Parte sopra', f.topSize), sizeChips(f.topSize, ['XS', 'S', 'M', 'L', 'XL', 'XXL']),
      field('Parte sotto', f.bottomSize),
      field('Scarpe (EU)', f.shoe), sizeChips(f.shoe, ['38', '39', '40', '41', '42', '43', '44', '45', '46']),
      field('Taglie per marca', f.brandSizes)),
    section('Misure', 'Facoltative: aiutano quando una marca veste diversa.',
      h('div', { class: 'two' }, field('Altezza (cm)', f.height), field('Peso (kg)', f.weight)),
      h('div', { class: 'two' }, field('Torace (cm)', f.chest), field('Vita (cm)', f.waist)),
      field('Fianchi (cm)', f.hips)),
    section('Vestibilità', 'Come ti piace che stiano i vestiti: la uso nei link per comprare.', fitChips),
    section('Il tuo stile', 'Tocca gli stili che ti somigliano: le proposte li preferiscono.', styles,
      h('button', { class: 'link-btn', type: 'button', onclick: () => profileSetup({ force: true }).then(route) }, 'Rivedi gli stili con le foto (rifai il questionario)')),
    section('Quando ti vesti', 'Le occasioni più frequenti: la prima è quella di partenza in Outfit.', occasions),
    section('Colori', 'Tocca un colore che ami o che vuoi evitare.', colorWrap),
    section('Budget per capo', null, budgetChips),
    section('Note', null, f.notes),
  );
  paintProgress();
}

// ---------- Impostazioni ----------

const THEMES = { uomo: '♂ Uomo · antracite e rame', donna: '♀ Donna · champagne e oro rosa', unisex: '⚥ Unisex · nero, bianco e oro' };

const currentPalette = () => document.documentElement.dataset.palette || '';

function paintThemeColor() {
  const t = document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]').content = currentPalette() === 'unisex' ? '#0b0b0b' : t === 'donna' ? '#f4e9da' : '#1c1d1f';
}

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  paintThemeColor();
  try { localStorage.setItem('menga-tema', t); } catch (e) { /* resta per questa sessione */ }
  updateThemeBtn();
}

// Colori dell'app: seguono il profilo (Uomo antracite e rame, Donna champagne e oro rosa) o Unisex.
function setPalette(p) {
  if (p) document.documentElement.dataset.palette = p; else delete document.documentElement.dataset.palette;
  paintThemeColor();
  try { localStorage.setItem('menga-palette', p); } catch (e) { /* resta per questa sessione */ }
}

// Stile dell'app: uomo, donna o unisex. Unisex cambia solo i colori (nero, bianco e oro):
// capi e manichino restano quelli del tuo profilo (uomo se il profilo è "Entrambi").
const currentMode = () => (currentPalette() === 'unisex' ? 'unisex' : document.documentElement.dataset.theme === 'donna' ? 'donna' : 'uomo');

function setTheme(t) {
  if (t === 'unisex') {
    setPalette('unisex');
    applyTheme(profileGender === 'donna' ? 'donna' : 'uomo');
  } else {
    setPalette('');
    applyTheme(t);
  }
  updateThemeBtn();
  route(); // ridisegna l'anteprima con il manichino giusto
}

// Tasto in alto: gira tra Uomo, Donna e Unisex.
const NEXT_MODE = { uomo: 'donna', donna: 'unisex', unisex: 'uomo' };
const MODE_NAME = { uomo: 'Stile uomo', donna: 'Stile donna', unisex: 'Stile unisex' };
const themeBtn = document.getElementById('theme-btn');
function updateThemeBtn() {
  const m = currentMode();
  themeBtn.dataset.mode = m;
  themeBtn.setAttribute('aria-label', `${MODE_NAME[m]}: tocca per passare a ${MODE_NAME[NEXT_MODE[m]].toLowerCase()}`);
  themeBtn.title = MODE_NAME[m];
}
updateThemeBtn();
themeBtn.addEventListener('click', () => {
  const t = NEXT_MODE[currentMode()];
  setTheme(t);
  toast(MODE_NAME[t]);
});

async function openSettings() {
  openDialog((close) => {
    const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });

    const doExport = async () => {
      const data = await db.exportBackup();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `menga-dress-backup-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a);
      a.click();
      a.remove();
      toast('Backup scaricato');
    };

    fileIn.addEventListener('change', async () => {
      const file = fileIn.files?.[0];
      fileIn.value = '';
      if (!file) return;
      try {
        const n = await db.importBackup(JSON.parse(await file.text()));
        await loadCustom();
        toast(`Ripristinati ${n} capi`);
        close();
        route();
      } catch (e) {
        toast(e.message || 'Backup non valido');
      }
    });

    return h('div', { class: 'sheet' },
      sheetHead('Impostazioni', close),
      h('p', { class: 'hint' }, 'Menga Dress è gratuita: funziona tutta sul telefono. L\'account è facoltativo e serve solo per avere l\'armadio anche su altri dispositivi.'),
      h('h2', {}, 'Backup'),
      h('p', { class: 'hint' }, 'Armadio, outfit e profilo sono salvati solo su questo telefono. Scarica un backup ogni tanto per non perderli.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: doExport }, 'Scarica backup'),
        h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, 'Ripristina backup')),
      fileIn,
      accountSection(close),
      h('h2', {}, 'Manichini'),
      mannequinSection(),
      statsSection(),
      h('h2', {}, 'Stile dell\'app'),
      h('p', { class: 'hint' }, 'Lo cambi anche con il tasto in alto a destra. Unisex cambia solo i colori: capi e manichino restano quelli del tuo profilo.'),
      chipGroup(THEMES, currentMode(), { onChange: setTheme }),
      h('h2', {}, 'Guida'),
      h('button', { class: 'btn block', type: 'button', onclick: () => { close(); welcome(true); } }, 'Rivedi la guida'),
      h('p', { class: 'hint' }, `Versione ${APP_VERSION}`),
    );
  });
}

// ---------- statistiche dell'app (solo amministratore) ----------
// Iscritti e quanto usano l'app, dalla funzione admin_stats di Supabase (supabase/statistiche.sql).
// Si vedono solo gli utenti con un account: chi non accede tiene tutto sul telefono.
function statsSection() {
  const box = h('div', { hidden: true });
  const body = h('div');
  const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : '—');
  const load = async () => {
    body.replaceChildren(h('div', { class: 'status' }, h('span', { class: 'spinner' }), 'Carico le statistiche…'));
    try {
      const sb = await sync.client();
      const { data, error } = await sb.rpc('admin_stats');
      if (error) throw error;
      const rows = data || [];
      const DAY = 86400000;
      const since = (iso, days) => iso && Date.now() - new Date(iso).getTime() < days * DAY;
      const active7 = rows.filter((r) => since(r.ultima_modifica, 7) || since(r.ultimo_accesso, 7)).length;
      const active30 = rows.filter((r) => since(r.ultima_modifica, 30) || since(r.ultimo_accesso, 30)).length;
      const capi = rows.reduce((a, r) => a + Number(r.capi || 0), 0);
      const outfit = rows.reduce((a, r) => a + Number(r.outfit || 0), 0);
      const tile = (n, label) => h('div', {}, h('b', {}, String(n)), h('small', {}, label));
      body.replaceChildren(
        h('div', { class: 'profile-stats stats-grid' },
          tile(rows.length, 'iscritti'), tile(active7, 'attivi 7 giorni'), tile(active30, 'attivi 30 giorni'),
          tile(capi, 'capi caricati'), tile(outfit, 'outfit salvati')),
        h('div', { class: 'stats-table' },
          h('div', { class: 'stats-row head' }, h('span', {}, 'Utente'), h('span', {}, 'Capi'), h('span', {}, 'Outfit'), h('span', {}, 'Ultimo uso')),
          rows.map((r) => h('div', { class: 'stats-row' },
            h('span', { title: `Iscritto il ${fmtDay(r.iscritto)}` }, r.email || '—'),
            h('span', {}, String(r.capi ?? 0)),
            h('span', {}, `${r.outfit ?? 0}${r.indossati ? ` (${r.indossati} ✓)` : ''}`),
            h('span', {}, fmtDay(r.ultima_modifica || r.ultimo_accesso))))),
        h('p', { class: 'hint' }, 'Contano solo gli utenti con un account. Chi usa l\'app senza accedere tiene tutto sul suo telefono e qui non si vede. ✓ = outfit indossati.'),
        h('button', { class: 'link-btn', type: 'button', onclick: load }, 'Aggiorna'));
    } catch (e) {
      console.warn('statistiche', e);
      const missing = /admin_stats|function|schema cache/i.test(e?.message || '');
      body.replaceChildren(h('p', { class: 'hint' }, missing
        ? 'Manca un passo su Supabase: apri il SQL Editor, incolla il contenuto di supabase/statistiche.sql (nel codice dell\'app) e premi Run. Basta una volta.'
        : `Non riesco a leggere le statistiche: ${sync.friendlyError(e)}`),
      h('button', { class: 'link-btn', type: 'button', onclick: load }, 'Riprova'));
    }
  };
  isAdmin().then((v) => {
    if (!v) return;
    box.hidden = false;
    box.replaceChildren(h('h2', {}, 'Statistiche dell\'app'), body);
    load();
  });
  return box;
}

// ---------- account e sincronizzazione ----------

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : 'mai');

async function runSync({ quiet = false } = {}) {
  try {
    const pulled = await sync.syncNow();
    if (pulled) route();
    if (!quiet) toast(pulled ? `Sincronizzato: ${pulled} novità` : 'Tutto sincronizzato');
    return true;
  } catch (e) {
    console.warn('sync', e);
    if (!quiet) toast('Sincronizzazione non riuscita: ' + sync.friendlyError(e));
    return false;
  }
}

// Schermata di accesso / registrazione. onDone viene chiamata dopo l'accesso.
function openLogin({ first = false } = {}) {
  let mode = 'in'; // 'in' accedi, 'up' registrati
  openDialog((close) => {
    const email = h('input', { type: 'email', autocomplete: 'email', inputmode: 'email', placeholder: 'nome@email.it', required: true });
    const pass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'almeno 6 caratteri', minlength: '6', required: true });
    const msg = h('p', { class: 'error', role: 'alert' });
    const info = h('p', { class: 'hint' });
    const submit = h('button', { class: 'btn primary block', type: 'submit' });
    const swap = h('button', { class: 'btn block', type: 'button' });
    const forgot = h('button', { class: 'link-btn', type: 'button' }, 'Password dimenticata?');
    const title = h('h2', {});
    const google = h('button', { class: 'btn block google-btn', type: 'button' },
      h('span', { class: 'g-logo', 'aria-hidden': 'true', html: '<svg viewBox="0 0 48 48" width="20" height="20"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>' }),
      'Accedi con Google');
    google.addEventListener('click', async () => {
      msg.textContent = '';
      google.disabled = true;
      try { await sync.signInWithGoogle(); } catch (e) { msg.textContent = sync.friendlyError(e); google.disabled = false; }
    });

    const paint = () => {
      title.textContent = mode === 'in' ? 'Accedi' : 'Crea il tuo account';
      submit.textContent = mode === 'in' ? 'Accedi' : 'Crea account';
      swap.textContent = mode === 'in' ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi';
      pass.autocomplete = mode === 'in' ? 'current-password' : 'new-password';
      forgot.hidden = mode !== 'in';
      msg.textContent = '';
    };
    swap.addEventListener('click', () => { mode = mode === 'in' ? 'up' : 'in'; paint(); });

    forgot.addEventListener('click', async () => {
      msg.textContent = '';
      if (!email.value.trim()) { msg.textContent = 'Scrivi prima la tua email.'; email.focus(); return; }
      try {
        await sync.resetPassword(email.value.trim());
        info.textContent = 'Ti ho mandato un\'email: apri il link per scegliere una nuova password.';
      } catch (e) { msg.textContent = sync.friendlyError(e); }
    });

    const form = h('form', { class: 'login-form' },
      h('label', { class: 'field' }, h('span', {}, 'Email'), email),
      h('label', { class: 'field' }, h('span', {}, 'Password'), pass),
      msg, info, submit, forgot, h('div', { class: 'login-sep' }), swap);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      msg.textContent = ''; info.textContent = '';
      submit.disabled = true;
      try {
        if (mode === 'up') {
          const { needsConfirm } = await sync.signUp(email.value.trim(), pass.value);
          if (needsConfirm) {
            info.textContent = 'Account creato! Ti ho mandato un\'email: apri il link di conferma, poi torna qui e fai Accedi.';
            mode = 'in'; paint();
            return;
          }
        } else {
          await sync.signIn(email.value.trim(), pass.value);
        }
        close();
        toast('Accesso fatto, sincronizzo l\'armadio…');
        await runSync();
      } catch (e) {
        msg.textContent = sync.friendlyError(e);
      } finally {
        submit.disabled = false;
      }
    });

    const skip = first ? h('button', { class: 'link-btn', type: 'button', onclick: () => {
      try { localStorage.setItem('menga-skip-login', '1'); } catch (e) { /* niente */ }
      close();
    } }, 'Continua senza account') : null;

    paint();
    return h('div', { class: 'sheet login' },
      first
        ? h('div', { class: 'login-head' }, brandLogo())
        : sheetHead('Account', close),
      title,
      h('p', { class: 'hint' }, 'Con l\'account il tuo armadio, gli outfit e il profilo si salvano anche online e li ritrovi su ogni dispositivo.'),
      google,
      h('p', { class: 'login-or' }, 'oppure con email'),
      form,
      skip);
  });
}

function openNewPassword() {
  openDialog((close) => {
    const pass = h('input', { type: 'password', autocomplete: 'new-password', minlength: '6', required: true });
    const msg = h('p', { class: 'error', role: 'alert' });
    const form = h('form', {},
      h('label', { class: 'field' }, h('span', {}, 'Nuova password'), pass), msg,
      h('button', { class: 'btn primary block', type: 'submit' }, 'Salva password'));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try { await sync.updatePassword(pass.value); close(); toast('Password aggiornata'); runSync({ quiet: true }); } catch (e) { msg.textContent = sync.friendlyError(e); }
    });
    return h('div', { class: 'sheet' }, sheetHead('Scegli una nuova password', close), form);
  });
}

function accountSection(closeSettings) {
  const box = h('div', { class: 'account' }, h('h2', {}, 'Account'));
  if (!sync.isConfigured()) {
    const url = h('input', { type: 'text', placeholder: 'https://xxxx.supabase.co', autocomplete: 'off', spellcheck: 'false' });
    const key = h('input', { type: 'text', placeholder: 'sb_publishable_… (o anon eyJ…)', autocomplete: 'off', spellcheck: 'false' });
    const msg = h('p', { class: 'error' });
    box.append(
      h('p', { class: 'hint' }, 'Per usare il login collega una volta il tuo progetto Supabase gratuito (Project Settings → API).'),
      h('label', { class: 'field' }, h('span', {}, 'Project URL'), url),
      h('label', { class: 'field' }, h('span', {}, 'Chiave publishable (o anon)'), key),
      msg,
      h('button', { class: 'btn', type: 'button', onclick: () => {
        try { sync.setConfig(url.value, key.value); closeSettings(); initAccount(); openLogin(); } catch (e) { msg.textContent = e.message; }
      } }, 'Collega'));
    return box;
  }
  const status = h('p', { class: 'hint' }, 'Controllo l\'account…');
  const actions = h('div', { class: 'row' });
  box.append(status, actions);
  sync.currentUser().then((user) => {
    if (!user) {
      status.textContent = 'Non hai fatto l\'accesso: l\'armadio è solo su questo telefono.';
      actions.append(h('button', { class: 'btn primary', type: 'button', onclick: () => { closeSettings(); openLogin(); } }, 'Accedi o registrati'));
    } else {
      status.textContent = `Accesso come ${user.email}. Ultima sincronizzazione: ${fmtTime(sync.lastSync())}.`;
      const now = h('button', { class: 'btn', type: 'button' }, 'Sincronizza ora');
      now.addEventListener('click', async () => {
        now.disabled = true;
        await runSync();
        now.disabled = false;
        status.textContent = `Accesso come ${user.email}. Ultima sincronizzazione: ${fmtTime(sync.lastSync())}.`;
      });
      actions.append(now, h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!confirm('Uscire dall\'account? L\'armadio resta su questo telefono.')) return;
        await sync.signOut();
        closeSettings();
        toast('Sei uscito dall\'account');
      } }, 'Esci'));
    }
  }).catch(() => { status.textContent = 'Supabase non raggiungibile (sei offline?).'; });
  if (!sync.getConfig().fixed) {
    box.append(h('button', { class: 'link-btn', type: 'button', onclick: async () => {
      if (!confirm('Scollegare il progetto Supabase da questo telefono?')) return;
      await sync.signOut().catch(() => {});
      sync.clearConfig();
      closeSettings();
    } }, 'Scollega progetto Supabase'));
  }
  return box;
}

let accountReady = false;
async function initAccount() {
  if (!sync.isConfigured() || accountReady) return;
  accountReady = true;
  try {
    await sync.onAuthChange((event) => { if (event === 'PASSWORD_RECOVERY') openNewPassword(); });
    const user = await sync.currentUser();
    if (user) {
      runSync({ quiet: true });
    }
    // Niente finestra di accesso all'avvio: l'account è facoltativo e sta nelle Impostazioni.
  } catch (e) {
    accountReady = false;
    console.warn('account', e); // offline o Supabase in pausa: l'app funziona lo stesso
  }
}

let syncTimer;
window.addEventListener('menga-change', () => {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => { if (await sync.currentUser().catch(() => null)) runSync({ quiet: true }); }, 3000);
});
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && await sync.currentUser().catch(() => null)) runSync({ quiet: true });
});

// ---------- Benvenuto ----------
// Guida di tre schermate al primo avvio (solo se l'armadio è vuoto: chi la usa già non la vede).
const WELCOME = [
  ['👕', 'Fotografa i tuoi capi', 'Tocca + nell\'Armadio e scatta una foto. L\'app toglie lo sfondo e riconosce da sola tipo e colori.'],
  ['✨', 'Ogni giorno un outfit', 'In Outfit scegli umore e occasione: l\'app guarda il meteo e ti propone 3 abbinamenti sul manichino. Se manca qualcosa ti dice cosa prendere.'],
  ['📅', 'Tieni il diario', 'Segna cosa indossi e pianifica la settimana. Ora qualche domanda su taglie e gusti: le proposte diventano su misura.'],
];
async function welcome(force = false) {
  try {
    const done = () => { try { localStorage.setItem('menga-benvenuto', '1'); } catch (e) { /* niente */ } };
    if (!force) {
      if (localStorage.getItem('menga-benvenuto')) return;
      if ((await db.getAll('items')).length) { done(); return; }
    }
    await new Promise((resolve) => {
      let step = 0;
      openDialog((close) => {
        const box = h('div', { class: 'sheet welcome' });
        const finish = () => { done(); close(); resolve(); };
        const paint = () => {
          const [icon, title, text] = WELCOME[step];
          const last = step === WELCOME.length - 1;
          box.replaceChildren(
            step === 0 ? h('div', { class: 'login-head' }, brandLogo(), h('h1', {}, 'Benvenuto')) : null,
            h('div', { class: 'welcome-icon', 'aria-hidden': 'true' }, icon),
            h('h2', {}, title),
            h('p', {}, text),
            h('div', { class: 'welcome-dots' }, WELCOME.map((_, i) => h('i', { class: i === step ? 'on' : '' }))),
            h('button', { class: 'btn primary block', type: 'button', onclick: () => { if (last) finish(); else { step++; paint(); } } }, last ? 'Inizia' : 'Avanti'),
            last ? null : h('button', { class: 'link-btn', type: 'button', onclick: finish }, 'Salta'),
          );
        };
        paint();
        return box;
      });
      // Chiusa col tasto indietro: conta come vista.
      document.querySelector('dialog:last-of-type')?.addEventListener('close', () => { done(); resolve(); });
    });
  } catch (e) { /* senza localStorage o IndexedDB si va avanti */ }
}

// ---------- Questionario del profilo ----------
// Alla prima apertura (e finché non è finito) l'app chiede taglie, vestibilità, stili, colori,
// occasioni e budget: servono alle proposte di outfit e ai link per comprare nella tua taglia.
// Non si può saltare. Si può rifare dal Profilo.

// Un outfit d'esempio per ogni stile, disegnato sul manichino dell'app.
const ES = (category, subcategory, color, pattern = 'solid') => ({ id: `es:${subcategory}:${color}`, category, subcategory, colors: [color], pattern });
const STYLE_LOOKS = {
  casual: { occ: 'tempo_libero', uomo: [ES('top', 'T-shirt', 'bianco'), ES('bottom', 'Jeans', 'denim'), ES('shoes', 'Sneakers', 'bianco')],
    donna: [ES('top', 'T-shirt', 'bianco'), ES('bottom', 'Jeans', 'denim'), ES('shoes', 'Sneakers', 'bianco')] },
  minimal: { occ: 'tempo_libero', uomo: [ES('top', 'T-shirt', 'nero'), ES('bottom', 'Chino', 'grigio'), ES('shoes', 'Sneakers', 'bianco')],
    donna: [ES('top', 'T-shirt', 'nero'), ES('bottom', 'Pantaloni eleganti', 'beige'), ES('shoes', 'Sneakers', 'bianco')] },
  smart_casual: { occ: 'lavoro', uomo: [ES('outerwear', 'Blazer', 'blu navy'), ES('top', 'Camicia', 'azzurro'), ES('bottom', 'Chino', 'beige'), ES('shoes', 'Mocassini', 'marrone')],
    donna: [ES('outerwear', 'Blazer', 'beige'), ES('top', 'Camicetta', 'bianco'), ES('bottom', 'Jeans', 'denim'), ES('shoes', 'Mocassini', 'marrone')] },
  formal: { occ: 'evento', uomo: [ES('dress', 'Completo', 'nero'), ES('top', 'Camicia elegante', 'bianco'), ES('shoes', 'Scarpe eleganti', 'nero')],
    donna: [ES('dress', 'Abito elegante', 'nero'), ES('shoes', 'Décolleté', 'nero')] },
  sporty: { occ: 'sport', uomo: [ES('top', 'Maglia sportiva', 'blu'), ES('bottom', 'Pantaloni sportivi', 'nero'), ES('shoes', 'Scarpe da corsa', 'grigio')],
    donna: [ES('top', 'Maglia sportiva', 'rosa'), ES('bottom', 'Leggings', 'nero'), ES('shoes', 'Scarpe da corsa', 'bianco')] },
  streetwear: { occ: 'tempo_libero', uomo: [ES('outerwear', 'Giubbotto', 'verde oliva'), ES('top', 'Felpa', 'nero'), ES('bottom', 'Cargo', 'beige'), ES('shoes', 'Sneakers', 'bianco')],
    donna: [ES('outerwear', 'Giubbotto', 'nero'), ES('top', 'Felpa', 'grigio'), ES('bottom', 'Cargo', 'verde oliva'), ES('shoes', 'Sneakers', 'bianco')] },
  classic: { occ: 'lavoro', uomo: [ES('outerwear', 'Blazer', 'grigio'), ES('top', 'Camicia elegante', 'bianco'), ES('bottom', 'Pantaloni eleganti', 'blu navy'), ES('shoes', 'Scarpe eleganti', 'marrone')],
    donna: [ES('outerwear', 'Blazer', 'blu navy'), ES('top', 'Camicetta', 'bianco'), ES('bottom', 'Pantaloni eleganti', 'blu navy'), ES('shoes', 'Décolleté', 'beige')] },
  boho: { occ: 'tempo_libero', uomo: [ES('top', 'Camicia', 'beige', 'floral'), ES('bottom', 'Chino', 'marrone'), ES('shoes', 'Sandali', 'marrone')],
    donna: [ES('dress', 'Vestito', 'arancione', 'floral'), ES('shoes', 'Sandali', 'marrone')] },
  romantic: { occ: 'serata', uomo: [ES('top', 'Camicia', 'rosa'), ES('bottom', 'Chino', 'bianco'), ES('shoes', 'Mocassini', 'marrone')],
    donna: [ES('top', 'Camicetta', 'rosa'), ES('bottom', 'Gonna', 'bianco'), ES('shoes', 'Décolleté', 'beige')] },
  edgy: { occ: 'serata', uomo: [ES('outerwear', 'Giubbotto', 'nero'), ES('top', 'T-shirt', 'grigio'), ES('bottom', 'Jeans', 'nero'), ES('shoes', 'Stivaletti', 'nero')],
    donna: [ES('outerwear', 'Giubbotto', 'nero'), ES('top', 'Top', 'nero'), ES('bottom', 'Jeans', 'nero'), ES('shoes', 'Stivaletti', 'nero')] },
};
const STYLE_HINTS = {
  casual: 'Comodo, jeans e sneakers', minimal: 'Pochi colori, linee pulite', smart_casual: 'Curato ma non formale',
  formal: 'Abiti e cerimonie', sporty: 'Tute e scarpe da corsa', streetwear: 'Felpe, cargo, stile urbano',
  classic: 'Senza tempo, sartoriale', boho: 'Fantasie, toni caldi', romantic: 'Colori tenui, dettagli delicati', edgy: 'Nero, pelle, stivaletti',
};
const SIZES = {
  top: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  bottom: { uomo: ['44', '46', '48', '50', '52', '54', '56'], donna: ['38', '40', '42', '44', '46', '48', '50'] },
  shoe: { uomo: ['39', '40', '41', '42', '43', '44', '45', '46', '47'], donna: ['35', '36', '37', '38', '39', '40', '41', '42'] },
};

const profileDone = (p) => !!p?.onboarded;

async function profileSetup({ force = false } = {}) {
  let p;
  try { p = (await db.getKV('profile')) || {}; } catch { return false; }
  if (!force && profileDone(p)) return false;
  const list = (v) => String(v || '').toLowerCase().split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
  const d = {
    gender: p.gender || '', topSize: p.topSize || '', bottomSize: p.bottomSize || '', shoe: p.shoe || '',
    height: p.height || '', weight: p.weight || '', fit: p.fit || '',
    styles: [...(p.styles || [])], liked: new Set(list(p.likedColors)), avoid: new Set(list(p.avoidColors)),
    occasions: [...(p.occasions || [])], budget: p.budget || '',
  };
  const sex = () => (d.gender === 'uomo' || d.gender === 'donna' ? d.gender : currentGender());

  await new Promise((resolve) => {
    const dlg = h('dialog', { class: 'setup-dlg' });
    // Obbligatorio: il tasto indietro non lo chiude.
    dlg.addEventListener('cancel', (e) => e.preventDefault());
    const box = h('div', { class: 'sheet setup' });
    dlg.append(box);
    document.body.append(dlg);
    dlg.showModal();
    let step = 0;

    const sizeField = (label, key, sizes, ph) => {
      const input = h('input', { type: 'text', value: d[key], placeholder: ph, inputmode: key === 'topSize' ? 'text' : 'numeric' });
      const chips = chipGroup(Object.fromEntries(sizes.map((x) => [x, x])), d[key], { onChange: (v) => { d[key] = v; input.value = v; check(); } });
      input.addEventListener('input', () => { d[key] = input.value.trim(); check(); });
      return h('div', { class: 'field' }, h('span', {}, label), chips, input);
    };
    const num = (label, key, ph) => {
      const input = h('input', { type: 'number', inputmode: 'numeric', value: d[key], placeholder: ph });
      input.addEventListener('input', () => { d[key] = input.value.trim(); });
      return field(label, input);
    };
    const colorRow = (set, other) => h('div', { class: 'chips swatches' }, Object.keys(PALETTE).map((name) => {
      const [r, g, b] = PALETTE[name];
      return h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(set.has(name)),
        onclick: () => { if (set.has(name)) set.delete(name); else { set.add(name); other.delete(name); } paint(); },
      }, h('span', { class: 'swatch', style: `background: rgb(${r},${g},${b})` }), name);
    }));

    // Ogni passo: titolo, spiegazione, contenuto e cosa manca per andare avanti.
    const STEPS = [
      {
        title: 'Che vestiti porti?', hint: 'Non conta chi sei, solo i capi che ti piace indossare. Decide in quale armadio vanno i capi nuovi.',
        body: () => [chipGroup(SECTION_LABELS, d.gender, { onChange: (v) => { d.gender = v; check(); } })],
        missing: () => (d.gender ? '' : 'Scegli una delle tre risposte.'),
      },
      {
        title: 'Le tue taglie', hint: 'Le metto nei link per comprare, così trovi i capi nella tua taglia.',
        body: () => [
          sizeField('Parte sopra (maglie, camicie, giacche)', 'topSize', SIZES.top, 'es. M'),
          sizeField('Parte sotto (pantaloni, gonne)', 'bottomSize', SIZES.bottom[sex()], 'es. 48 o W32 L32'),
          sizeField('Scarpe (EU)', 'shoe', SIZES.shoe[sex()], 'es. 43'),
          h('div', { class: 'two' }, num('Altezza (cm), facoltativa', 'height', 'cm'), num('Peso (kg), facoltativo', 'weight', 'kg')),
        ],
        missing: () => (!d.topSize ? 'Manca la taglia della parte sopra.' : !d.bottomSize ? 'Manca la taglia della parte sotto.' : !d.shoe ? 'Manca il numero di scarpe.' : ''),
      },
      {
        title: 'Come ti piace che stiano?', hint: 'La vestibilità che preferisci: la uso per cercare i capi da comprare.',
        body: () => [chipGroup(FITS, d.fit, { onChange: (v) => { d.fit = v; check(); } })],
        missing: () => (d.fit ? '' : 'Scegli una vestibilità.'),
      },
      {
        title: 'Che stile ti somiglia?', hint: 'Tocca uno o più esempi: le proposte di outfit e i capi da comprare li preferiranno.',
        body: () => [h('div', { class: 'style-cards' }, Object.entries(STYLES).map(([key, label]) => {
          const look = STYLE_LOOKS[key];
          const b = h('button', { type: 'button', class: 'style-card', 'aria-pressed': String(d.styles.includes(key)),
            onclick: () => {
              d.styles = d.styles.includes(key) ? d.styles.filter((x) => x !== key) : [...d.styles, key];
              b.setAttribute('aria-pressed', String(d.styles.includes(key)));
              check();
            } },
          lookView(look[sex()], look.occ, sex()),
          h('b', {}, label), h('small', {}, STYLE_HINTS[key]));
          return b;
        }))],
        missing: () => (d.styles.length ? '' : 'Scegli almeno uno stile.'),
      },
      {
        title: 'I tuoi colori', hint: 'I colori che ami finiscono più spesso negli outfit; quelli da evitare mai nei consigli per comprare.',
        body: () => [
          h('div', { class: 'field' }, h('span', {}, 'Colori che ami (almeno uno)'), colorRow(d.liked, d.avoid)),
          h('div', { class: 'field' }, h('span', {}, 'Colori da evitare (facoltativo)'), colorRow(d.avoid, d.liked)),
        ],
        missing: () => (d.liked.size ? '' : 'Scegli almeno un colore che ami.'),
      },
      {
        title: 'Quando ti vesti e quanto spendi', hint: 'Le occasioni più frequenti e il budget per un capo nuovo.',
        body: () => [
          h('div', { class: 'field' }, h('span', {}, 'Occasioni più frequenti'),
            chipGroup(OCCASIONS, d.occasions, { multiple: true, onChange: (v) => { d.occasions = v; check(); } })),
          h('div', { class: 'field' }, h('span', {}, 'Budget per capo'),
            chipGroup(BUDGETS, d.budget, { onChange: (v) => { d.budget = v; check(); } })),
        ],
        missing: () => (!d.occasions.length ? 'Scegli almeno un\'occasione.' : !d.budget ? 'Scegli un budget.' : ''),
      },
    ];

    const note = h('p', { class: 'hint setup-missing' });
    let next;
    function check() {
      const m = STEPS[step].missing();
      note.textContent = m;
      next.disabled = !!m;
    }
    const finish = async () => {
      const out = {
        ...p, gender: d.gender, topSize: d.topSize, bottomSize: d.bottomSize, shoe: d.shoe, height: d.height, weight: d.weight,
        fit: d.fit, styles: d.styles, likedColors: [...d.liked].join(', '), avoidColors: [...d.avoid].join(', '),
        occasions: d.occasions, budget: d.budget, onboarded: new Date().toISOString(),
      };
      await db.setKV('profile', out).catch(() => {});
      profileGender = d.gender;
      // Manichini e tema come lo stile scelto (poi si cambiano col tasto ♂/♀ in alto).
      if (d.gender === 'uomo' || d.gender === 'donna') { applyTheme(d.gender); updateThemeBtn(); }
      // Outfit parte dall'occasione più frequente, se non ne hai già scelta una.
      let chosen = true;
      try { chosen = !!localStorage.getItem('menga-outfit-scelte'); } catch { /* niente */ }
      if (!chosen && OCCASIONS[d.occasions[0]]) { outfitState.occasion = d.occasions[0]; rememberChoices(); }
      outfitState.results = null;
      dlg.close(); dlg.remove();
      toast('Profilo salvato: le proposte ora sono su misura per te');
      resolve();
    };
    function paint() {
      const st = STEPS[step];
      const last = step === STEPS.length - 1;
      next = h('button', { class: 'btn primary', type: 'button', onclick: () => { if (STEPS[step].missing()) return; if (last) finish(); else { step++; paint(); box.scrollTop = 0; dlg.scrollTop = 0; } } },
        last ? 'Fatto' : 'Avanti');
      box.replaceChildren(
        step === 0 ? h('div', { class: 'login-head' }, brandLogo(),
          h('h1', {}, 'Il tuo profilo'), h('p', { class: 'hint' }, 'Poche domande per consigliarti outfit e acquisti giusti per te. Restano solo sul telefono.')) : null,
        h('div', { class: 'welcome-dots' }, STEPS.map((_, i) => h('i', { class: i === step ? 'on' : '' }))),
        h('h2', {}, st.title),
        h('p', { class: 'hint' }, st.hint),
        ...st.body(),
        note,
        h('div', { class: 'row end setup-nav' },
          step ? h('button', { class: 'btn', type: 'button', onclick: () => { step--; paint(); } }, 'Indietro') : null,
          next));
      check();
    }
    paint();
  });
  return true;
}

// ---------- navigazione ----------

const routes = { armadio: renderWardrobe, outfit: renderOutfit, diario: renderDiary, profilo: renderProfile };

function route() {
  const name = (location.hash.replace(/^#\/?/, '') || 'armadio').split('/')[0];
  const render = routes[name] || renderWardrobe;
  for (const a of document.querySelectorAll('.tabbar a')) a.classList.toggle('active', a.dataset.tab === (routes[name] ? name : 'armadio'));
  render().catch((e) => {
    console.error(e);
    view.replaceChildren(h('p', { class: 'error' }, 'Qualcosa è andato storto: ' + e.message));
  });
  window.scrollTo(0, 0);
}

document.getElementById('settings-btn').addEventListener('click', openSettings);
window.addEventListener('hashchange', route);
// I manichini creati da te servono già al primo disegno dell'armadio.
loadCustom().catch(() => {}).then(route);
// Arrivati manichini pubblici nuovi: si ridisegna la pagina (se non c'è una scheda aperta).
window.addEventListener('manichini', () => { if (!document.querySelector('dialog[open]')) route(); });
db.askPersistence();
welcome().then(() => profileSetup()).then((shown) => { if (shown) route(); }).then(initAccount);
// L'app impara dai capi già salvati (in sottofondo, solo se il modello è già sul telefono).
if (isModelCached()) setTimeout(() => { learnFromWardrobe().catch(() => {}); }, 4000);

// Aggiornamenti: controlla subito se c'è una versione nuova (anche quando riapri l'app)
// e, appena è installata, ricarica la pagina da sola.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  });
}
