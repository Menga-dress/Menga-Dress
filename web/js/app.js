import * as db from './db.js';
import { getWeather } from './weather.js';
import { detectColors } from './colors.js';
import { suggestOutfits, ideaName } from './stylist.js';
import { lookView, garmentView, previewPhoto, forgetPhoto } from './look.js';
import { prepareMannequin, loadCustom, saveCustom, removeCustom } from './manichini.js';
import { analyzeGarment, isModelCached, rememberGarment, forgetGarment, learnFromWardrobe } from './riconosci.js';
import { removeBackground } from './sfondo.js';
import * as sync from './sync.js';
import {
  CATEGORIES, SEASONS, STYLES, PATTERNS, MOODS, OCCASIONS, FORMALITY, SUBTYPES, PALETTE, describeItem,
  mannequinMatch, currentGender, CUSTOM, ZONE_CATEGORIES, zoneOfCategory,
} from './catalog.js';

const APP_VERSION = '36'; // da aumentare a ogni modifica, si vede nelle Impostazioni
const view = document.getElementById('view');
const titleEl = document.getElementById('view-title');

// ---------- utilità ----------

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

function newMannequinPrompt(category, name) {
  const donna = currentGender() === 'donna';
  const what = EN[name] || name;
  const zone = ZONE_COLOR[category] || 'ROSSO puro';
  return [
    `Crea un'immagine verticale 2:3, figura intera, di un manichino ${donna ? 'femminile' : 'maschile'} nero lucido senza volto, in piedi su un piedistallo nero, sfondo nero con un sottile cerchio dorato dietro.`,
    `Il manichino indossa ${articolo(name)} (${what}), in tinta unita ${zone}, senza fantasie né scritte.`,
    'Gli altri capi in tinta unita a colori pieni: giacca ROSSO puro (se c\'è), maglia VERDE puro, pantaloni BLU puro, scarpe GIALLO puro.',
    'Luce morbida da studio, pieghe del tessuto visibili, nessun altro oggetto.',
  ].join(' ');
}

function showNewMannequin(category, name) {
  const prompt = newMannequinPrompt(category, name);
  openDialog((close) => h('div', { class: 'sheet' },
    sheetHead(`Nuovo manichino: ${name}`, close),
    h('p', {}, `I manichini ${currentGender()} non hanno ${articolo(name)}. Puoi crearne uno con ChatGPT o Gemini e caricarlo qui: l'app lo prepara da sola.`),
    h('ol', { class: 'steps' },
      h('li', {}, 'Copia il testo qui sotto e incollalo in ChatGPT.'),
      h('li', {}, `Controlla che ${articolo(name)} sia di un solo colore pieno (${ZONE_COLOR[category] || 'ROSSO puro'}), come gli altri capi.`),
      h('li', {}, 'Salva l\'immagine sul telefono e tocca "Carica il manichino".')),
    h('textarea', { class: 'prompt', readonly: true, rows: 7 }, prompt),
    h('div', { class: 'row end' },
      h('button', {
        type: 'button', class: 'btn primary',
        onclick: async () => {
          try { await navigator.clipboard.writeText(prompt); toast('Testo copiato'); } catch { toast('Tieni premuto sul testo per copiarlo'); }
        },
      }, 'Copia il testo'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => { close(); openMannequinEditor({ category, name }); } }, 'Carica il manichino'))));
}

// ---------- manichino creato da te ----------
const ZONE_LABEL = { 1: 'Giacca', 2: 'Maglia', 3: 'Pantaloni', 4: 'Scarpe' };
const ZONE_DOT = { 1: '#e65050', 2: '#5ac86e', 3: '#5a82f0', 4: '#f0d246' };
const ZONE_DEFAULT = { 1: 'Giubbotto', 2: 'T-shirt', 3: 'Jeans', 4: 'Sneakers' };
// Colori neutri per provare il manichino; la zona "da provare" prende il colore scelto.
const TRY_BASE = { 1: 'blu navy', 2: 'bianco', 3: 'denim', 4: 'bianco' };
const TRY_COLORS = ['bordeaux', 'blu navy', 'grigio', 'verde oliva', 'beige', 'nero'];
const MIN_ZONE = 1500; // pixel sotto i quali una zona non c'è

function openMannequinEditor({ category, name, onSaved } = {}) {
  openDialog((close) => {
    const wrap = h('div', { class: 'sheet' });
    const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const body = h('div');
    let prepared = null;

    const pick = () => fileIn.click();
    const intro = () => body.replaceChildren(
      h('p', {}, 'Carica l\'immagine del manichino fatta con ChatGPT o Gemini, con i capi a colori pieni: giacca rossa, maglia verde, pantaloni blu, scarpe gialle.'),
      category ? h('p', { class: 'hint' }, `${articolo(name)[0].toUpperCase()}${articolo(name).slice(1)} va in ${ZONE_COLOR[category] || 'ROSSO puro'}.`) : null,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: pick }, 'Scegli l\'immagine'),
        category ? h('button', { type: 'button', class: 'btn', onclick: () => { close(); showNewMannequin(category, name); } }, 'Testo per crearlo') : null),
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
      const occasions = chipGroup(OCCASIONS, ['tempo_libero'], { multiple: true });
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
          garments, base: prepared.base, zone: prepared.zone, createdAt: new Date().toISOString(),
        };
        try {
          await saveCustom(m);
        } catch (e) {
          console.warn('manichino', e);
          toast('Non sono riuscito a salvare il manichino.');
          return;
        }
        close();
        toast(`Manichino "${m.name}" aggiunto`);
        onSaved?.();
        route();
      };

      body.replaceChildren(pair, zoneList,
        h('h2', {}, 'Che capi mostra?'),
        ...zones.map((z) => h('label', { class: 'field' }, h('span', {}, ZONE_LABEL[z]), selects[z])),
        field('Nome', nameIn),
        h('div', { class: 'field' }, h('span', {}, 'Per'), gender),
        h('div', { class: 'field' }, h('span', {}, 'Occasioni'), occasions),
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
  const paintList = () => {
    box.replaceChildren(
      h('p', { class: 'hint' }, `L'app ha già 11 manichini uomo e 8 donna. Qui aggiungi i tuoi, fatti con ChatGPT o Gemini: restano su questo telefono e sono nel backup.`),
      h('div', { class: 'mlist' },
        ...CUSTOM.map((c) => {
          const cv = h('canvas', { 'aria-label': c.name });
          const p = {};
          for (const z of [1, 2, 3, 4]) if (c.garments?.[z]) p[z] = PALETTE[TRY_BASE[z]];
          previewPhoto(cv, c.base, c.zone, p).catch(() => {});
          return h('figure', {}, cv,
            h('figcaption', {}, c.name, h('small', {}, ` · ${c.gender}`)),
            h('button', {
              type: 'button', class: 'linkbtn',
              onclick: async () => {
                if (!confirm(`Togliere il manichino "${c.name}"?`)) return;
                await removeCustom(c.id);
                forgetPhoto(`mio:${c.id}`);
                paintList();
                toast('Manichino tolto');
              },
            }, 'Togli'));
        }),
        h('button', { type: 'button', class: 'madd', onclick: () => openMannequinEditor({ onSaved: paintList }) }, h('span', {}, '+'), 'Aggiungi')));
  };
  paintList();
  return box;
}

function newMannequinButton(category, name) {
  return h('div', {}, h('button', { type: 'button', class: 'btn small', onclick: () => showNewMannequin(category, name) }, 'Come creare il manichino'));
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
  const items = (await db.getAll('items')).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
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
            type: 'button', class: 'chip', onclick: () => showNewMannequin(it.category, it.subcategory),
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
  };
  editItem(item, { isNew: true });
}

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
    const paintMatch = () => {
      const name = f.subcategory.value.trim();
      if (!category || !name) { matchSlot.replaceChildren(); paintMannequin(); return; }
      const m = mannequinMatch(category, name);
      const who = currentGender() === 'donna' ? 'manichini donna' : 'manichini uomo';
      let box;
      if (!m) {
        box = h('div', { class: 'match warn' }, h('strong', {}, '⚠ Tipo non riconosciuto'),
          `"${name}" non è tra i tipi dell'app: scegli un tipo qui sopra per collegarlo a un capo dei ${who}.`);
      } else if (m.same) {
        box = h('div', { class: 'match ok' }, h('strong', {}, `✓ Sui manichini: ${m.garment}`),
          `I ${who} hanno lo stesso capo, l'anteprima lo mostra col suo colore.`);
      } else {
        box = h('div', { class: 'match warn' }, h('strong', {}, `⚠ Serve un nuovo manichino: i ${who} non hanno ${articolo(name)}`),
          m.garment ? `Per ora nell'anteprima appare come il capo più simile: ${m.garment}.` : 'Per ora nell\'anteprima non compare.',
          newMannequinButton(category, name));
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

    const save = async () => {
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
      isNew ? null : h('p', { class: 'stat' },
        item.timesWorn ? `Indossato ${item.timesWorn} ${item.timesWorn === 1 ? 'volta' : 'volte'}, l'ultima il ${new Date(item.lastWorn).toLocaleDateString('it-IT')}` : 'Mai indossato finora'),
      h('div', { class: 'field' }, h('span', {}, 'Categoria'), categoryChips),
      typesSlot,
      field('Nome del capo', f.subcategory),
      matchSlot,
      h('div', { class: 'field' }, h('span', {}, 'Colori'), colorChips, f.colors),
      h('div', { class: 'two' }, field('Fantasia', f.pattern), field('Materiale', f.material)),
      field('Formalità', f.formality),
      h('div', { class: 'field' }, h('span', {}, 'Stagioni'), seasonsSlot),
      h('div', { class: 'field' }, h('span', {}, 'Stili'), stylesSlot),
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
        await cutBackground(false);
        colorsDone = runColors();
        runGarment();
      }, 0);
    }
    return wrap;
  });
}

// ---------- Outfit del giorno ----------

const outfitState = { mood: 'rilassato', occasion: 'tempo_libero', weather: null, weatherError: null, results: null };

async function renderOutfit() {
  titleEl.textContent = 'Outfit del giorno';
  view.replaceChildren();
  const items = await db.getAll('items');

  const fewItems = items.length < 4;

  const weatherBox = h('div', { class: 'card weather' });
  const paintWeather = () => {
    const w = outfitState.weather;
    if (w) {
      weatherBox.replaceChildren(h('b', {}, `${w.now}°`), h('span', {}, `${w.sky} · ${w.min}°/${w.max}° · prob. pioggia ${w.rain}%`));
    } else if (outfitState.weatherError) {
      weatherBox.replaceChildren(h('span', {}, `Meteo non disponibile (${outfitState.weatherError}).`),
        h('button', { class: 'btn', type: 'button', onclick: loadWeather }, 'Riprova'));
    } else {
      weatherBox.replaceChildren(h('span', { class: 'spinner' }), h('span', {}, 'Leggo il meteo…'));
    }
  };
  const loadWeather = async () => {
    outfitState.weatherError = null;
    paintWeather();
    try {
      outfitState.weather = await getWeather();
    } catch (e) {
      outfitState.weatherError = e.message;
    }
    paintWeather();
  };
  paintWeather();
  if (!outfitState.weather) loadWeather();

  const resultsBox = h('div');
  const go = h('button', { class: 'btn primary block', type: 'button' }, 'Proponimi 3 outfit');
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      const [profile, history] = await Promise.all([db.getKV('profile'), db.getAll('outfits')]);
      history.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      outfitState.results = suggestOutfits({
        items, profile, history,
        mood: outfitState.mood, occasion: outfitState.occasion,
        weather: outfitState.weather,
      });
      outfitState.profile = profile;
      paintResults(resultsBox, items);
      go.textContent = 'Altre proposte';
      resultsBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      resultsBox.replaceChildren(h('p', { class: 'error' }, e.message));
    } finally {
      go.disabled = false;
    }
  });

  view.append(
    weatherBox,
    fewItems ? h('p', { class: 'hint' }, items.length
      ? 'Hai ancora pochi capi: dove manca qualcosa ti propongo io cosa prendere.'
      : 'L\'armadio è vuoto: intanto ti propongo outfit completi con capi da prendere. Più capi aggiungi, più le proposte useranno i tuoi.') : null,
    h('h2', {}, 'Come ti senti oggi?'),
    chipGroup(MOODS, outfitState.mood, { onChange: (v) => { outfitState.mood = v; } }),
    h('h2', {}, 'Per cosa ti vesti?'),
    chipGroup(OCCASIONS, outfitState.occasion, { onChange: (v) => { outfitState.occasion = v; } }),
    go,
    h('div', { class: 'spacer' }),
    resultsBox,
  );

  if (outfitState.results) {
    paintResults(resultsBox, items);
    go.textContent = 'Altre proposte';
  }
}

function paintResults(box, items) {
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  box.replaceChildren();
  if (!outfitState.results?.length) {
    box.append(h('p', { class: 'error' }, 'Nessuna proposta valida, riprova.'));
    return;
  }
  for (const o of outfitState.results) {
    const record = {
      id: o.savedId || db.newId(),
      date: new Date().toISOString(),
      title: o.title, reason: o.reason, itemIds: o.item_ids,
      mood: outfitState.mood, occasion: outfitState.occasion,
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

    box.append(h('div', { class: 'card outfit' },
      h('h3', {}, o.title),
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
        h('span', {}, o.ideas.length === o.pieces.length ? 'Capi da prendere: ' : 'Per completarlo ti manca: '),
        ...o.ideas.flatMap((it, i) => [i ? ', ' : null,
          h('a', { href: shopLink(it), target: '_blank', rel: 'noopener' }, ideaName(it))].filter(Boolean)),
        h('span', {}, ' (tocca per cercarlo online)')) : null,
      h('div', { class: 'row' }, up, down, h('span', { style: 'flex:1' }), o.ideas.length === o.pieces.length ? null : wear)));
  }
}

// Anteprima: il manichino con i colori dei capi proposti, disegnato subito sul telefono.
function lookBox(pieces) {
  return h('figure', { class: 'look' }, lookView(pieces, outfitState.occasion), h('figcaption', {}, 'Anteprima dell\'outfit sul manichino'));
}

// Ricerca del capo online con la taglia del profilo.
function shopLink(it) {
  const p = outfitState.profile || {};
  const gender = { uomo: 'uomo', donna: 'donna' }[p.gender] || '';
  const size = it.category === 'shoes' ? p.shoe : it.category === 'bottom' ? p.bottomSize : p.topSize;
  const q = [ideaName(it), gender, size ? `taglia ${size}` : ''].filter(Boolean).join(' ');
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(q)}`;
}

// ---------- Profilo ----------

async function renderProfile() {
  titleEl.textContent = 'Profilo';
  const p = (await db.getKV('profile')) || {};
  const items = await db.getAll('items');
  view.replaceChildren();

  const f = {
    gender: select({ uomo: 'Uomo', donna: 'Donna', entrambi: 'Entrambi / unisex' }, p.gender, { empty: 'Non specificato' }),
    height: h('input', { type: 'number', inputmode: 'numeric', value: p.height || '', placeholder: 'cm' }),
    weight: h('input', { type: 'number', inputmode: 'numeric', value: p.weight || '', placeholder: 'kg' }),
    chest: h('input', { type: 'number', inputmode: 'numeric', value: p.chest || '', placeholder: 'cm' }),
    waist: h('input', { type: 'number', inputmode: 'numeric', value: p.waist || '', placeholder: 'cm' }),
    hips: h('input', { type: 'number', inputmode: 'numeric', value: p.hips || '', placeholder: 'cm' }),
    shoe: h('input', { type: 'text', value: p.shoe || '', placeholder: 'es. 43' }),
    topSize: h('input', { type: 'text', value: p.topSize || '', placeholder: 'es. M' }),
    bottomSize: h('input', { type: 'text', value: p.bottomSize || '', placeholder: 'es. 48 o W32 L32' }),
    brandSizes: h('textarea', { placeholder: 'Una per riga, es.\nZara: M\nUniqlo: L' }, p.brandSizes || ''),
    likedColors: h('input', { type: 'text', value: p.likedColors || '', placeholder: 'es. blu, verde oliva, beige' }),
    avoidColors: h('input', { type: 'text', value: p.avoidColors || '', placeholder: 'es. arancione' }),
    budget: h('input', { type: 'text', value: p.budget || '', placeholder: 'es. 50–100 € a capo' }),
    notes: h('textarea', { placeholder: 'es. preferisco vestiti comodi, non amo le cravatte' }, p.notes || ''),
  };
  const styles = chipGroup(STYLES, p.styles, { multiple: true });

  const save = async () => {
    const out = { styles: styles.value() };
    for (const [k, el] of Object.entries(f)) out[k] = el.value.trim();
    await db.setKV('profile', out);
    toast('Profilo salvato');
  };

  const worn = items.filter((i) => i.timesWorn).length;
  view.append(
    h('div', { class: 'card' },
      h('p', { class: 'stat' }, `${items.length} capi nell'armadio · ${worn} indossati almeno una volta`)),
    h('h2', {}, 'Chi sei'),
    field('Abbigliamento', f.gender),
    h('h2', {}, 'Misure'),
    h('div', { class: 'two' }, field('Altezza (cm)', f.height), field('Peso (kg)', f.weight)),
    h('div', { class: 'two' }, field('Torace (cm)', f.chest), field('Vita (cm)', f.waist)),
    h('div', { class: 'two' }, field('Fianchi (cm)', f.hips), field('Scarpe (EU)', f.shoe)),
    h('h2', {}, 'Taglie'),
    h('div', { class: 'two' }, field('Parte sopra', f.topSize), field('Parte sotto', f.bottomSize)),
    field('Taglie per marca', f.brandSizes),
    h('h2', {}, 'Gusti'),
    h('div', { class: 'field' }, h('span', {}, 'Stili preferiti'), styles),
    field('Colori che ami', f.likedColors),
    field('Colori da evitare', f.avoidColors),
    field('Budget per capo', f.budget),
    field('Note', f.notes),
    h('button', { class: 'btn primary block', type: 'button', onclick: save }, 'Salva profilo'),
  );
}

// ---------- Impostazioni ----------

const THEMES = { uomo: 'Uomo · scuro', donna: 'Donna · chiaro' };

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]').content = t === 'donna' ? '#e6d5b8' : '#1f1d1a';
  try { localStorage.setItem('menga-tema', t); } catch (e) { /* resta per questa sessione */ }
  updateThemeBtn();
  route(); // ridisegna l'anteprima con il manichino giusto
}

// Tasto in alto: passa da uomo a donna e viceversa.
const themeBtn = document.getElementById('theme-btn');
function updateThemeBtn() {
  const donna = document.documentElement.dataset.theme === 'donna';
  themeBtn.setAttribute('aria-label', donna ? 'Passa al manichino uomo (tema scuro)' : 'Passa al manichino donna (tema chiaro)');
  themeBtn.title = donna ? 'Donna · chiaro' : 'Uomo · scuro';
}
updateThemeBtn();
themeBtn.addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'donna' ? 'uomo' : 'donna';
  setTheme(t);
  toast(t === 'donna' ? 'Manichino donna' : 'Manichino uomo');
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
      h('h2', {}, 'Tema e manichino'),
      chipGroup(THEMES, document.documentElement.dataset.theme || 'uomo', { onChange: setTheme }),
      h('p', { class: 'hint' }, `Versione ${APP_VERSION}`),
    );
  });
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
        ? h('div', { class: 'login-head' }, h('img', { src: 'icons/icon-192-v3.png', alt: '', class: 'login-logo' }), h('h1', {}, 'Menga Dress'))
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
    } else if (!localStorage.getItem('menga-skip-login') && !/type=recovery/.test(location.hash)) {
      openLogin({ first: true });
    }
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

// ---------- navigazione ----------

const routes = { armadio: renderWardrobe, outfit: renderOutfit, profilo: renderProfile };

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
db.askPersistence();
initAccount();
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
