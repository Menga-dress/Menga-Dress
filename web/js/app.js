import * as db from './db.js';
import { analyzeItem, suggestOutfits, getSettings, hasKey, DEFAULT_MODEL } from './ai.js';
import { getWeather } from './weather.js';
import {
  CATEGORIES, SEASONS, STYLES, PATTERNS, MOODS, OCCASIONS, FORMALITY, describeItem,
} from './catalog.js';

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

async function renderWardrobe() {
  titleEl.textContent = 'Il mio armadio';
  const items = (await db.getAll('items')).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  view.replaceChildren();

  const filters = { all: 'Tutti', ...CATEGORIES };
  view.append(chipGroup(filters, wardrobeFilter, {
    scroll: true,
    onChange: (v) => { wardrobeFilter = v; renderWardrobe(); },
  }));

  const shown = wardrobeFilter === 'all' ? items : items.filter((i) => i.category === wardrobeFilter);

  if (!items.length) {
    view.append(h('div', { class: 'empty' },
      h('strong', {}, 'Il tuo armadio è vuoto'),
      'Tocca + per fotografare il primo capo. L\'AI lo riconosce e compila i dettagli per te.'));
  } else if (!shown.length) {
    view.append(h('div', { class: 'empty' }, 'Nessun capo in questa categoria.'));
  } else {
    view.append(h('p', { class: 'stat' }, `${shown.length} ${shown.length === 1 ? 'capo' : 'capi'}`));
    const grid = h('div', { class: 'grid' });
    for (const it of shown) {
      grid.append(h('button', { class: 'tile', type: 'button', onclick: () => editItem(it) },
        h('img', { src: imgURL(it), alt: describeItem(it), loading: 'lazy' }),
        h('span', { class: 'tag' }, it.subcategory || CATEGORIES[it.category] || 'Capo')));
    }
    view.append(grid);
  }

  const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) addItemFromFile(file);
  });
  view.append(input, h('button', { class: 'fab', type: 'button', 'aria-label': 'Aggiungi capo', onclick: () => input.click() }, '+'));
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
    const preview = h('img', { class: 'preview', src: URL.createObjectURL(item.image), alt: 'Foto del capo' });

    const f = {
      category: select(CATEGORIES, item.category, { empty: 'Scegli…' }),
      subcategory: h('input', { type: 'text', value: item.subcategory, placeholder: 'es. Camicia oxford' }),
      colors: h('input', { type: 'text', value: (item.colors || []).join(', '), placeholder: 'es. blu, bianco' }),
      pattern: select(PATTERNS, item.pattern),
      material: h('input', { type: 'text', value: item.material, placeholder: 'es. cotone' }),
      formality: select(FORMALITY, item.formality || 3),
      brand: h('input', { type: 'text', value: item.brand || '' }),
      size: h('input', { type: 'text', value: item.size || '', placeholder: 'es. M, 42' }),
      notes: h('textarea', {}, item.notes || ''),
    };
    let seasons = chipGroup(SEASONS, item.seasons, { multiple: true });
    let styles = chipGroup(STYLES, item.styles, { multiple: true });
    const seasonsSlot = h('div', {}, seasons);
    const stylesSlot = h('div', {}, styles);

    const applyAI = (r) => {
      f.category.value = r.category;
      f.subcategory.value = r.subcategory;
      f.colors.value = r.colors.join(', ');
      f.pattern.value = r.pattern;
      f.material.value = r.material;
      f.formality.value = String(r.formality);
      if (!f.notes.value) f.notes.value = r.description;
      seasons = chipGroup(SEASONS, r.seasons, { multiple: true });
      styles = chipGroup(STYLES, r.styles, { multiple: true });
      seasonsSlot.replaceChildren(seasons);
      stylesSlot.replaceChildren(styles);
    };

    const runAI = async () => {
      if (!(await hasKey())) {
        status.replaceChildren(h('p', { class: 'hint' }, 'Aggiungi la chiave API nelle impostazioni per far compilare i campi all\'AI. Intanto puoi compilarli a mano.'));
        return;
      }
      status.replaceChildren(h('div', { class: 'status' }, h('span', { class: 'spinner' }), 'L\'AI sta riconoscendo il capo…'));
      try {
        const r = await analyzeItem(item.image);
        if (!r.is_clothing) {
          status.replaceChildren(h('p', { class: 'error' }, 'Non vedo un capo in questa foto. Puoi comunque compilare i campi a mano.'));
          return;
        }
        applyAI(r);
        status.replaceChildren(h('p', { class: 'hint' }, 'Campi compilati dall\'AI: controllali e salva.'));
      } catch (e) {
        status.replaceChildren(h('p', { class: 'error' }, e.message));
      }
    };

    const save = async () => {
      if (!f.category.value) { toast('Scegli una categoria.'); f.category.focus(); return; }
      const updated = {
        ...item,
        category: f.category.value,
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
        updatedAt: new Date().toISOString(),
      };
      await db.put('items', updated);
      close();
      toast(isNew ? 'Capo aggiunto all\'armadio' : 'Modifiche salvate');
      renderWardrobe();
    };

    const del = async () => {
      if (!confirm('Eliminare questo capo dall\'armadio?')) return;
      await db.remove('items', item.id);
      close();
      toast('Capo eliminato');
      renderWardrobe();
    };

    wrap.append(...[
      sheetHead(isNew ? 'Nuovo capo' : 'Dettagli capo', close),
      preview,
      status,
      isNew ? null : h('p', { class: 'stat' },
        item.timesWorn ? `Indossato ${item.timesWorn} ${item.timesWorn === 1 ? 'volta' : 'volte'}, l'ultima il ${new Date(item.lastWorn).toLocaleDateString('it-IT')}` : 'Mai indossato finora'),
      field('Categoria', f.category),
      field('Tipo', f.subcategory),
      field('Colori', f.colors),
      h('div', { class: 'two' }, field('Fantasia', f.pattern), field('Materiale', f.material)),
      field('Formalità', f.formality),
      h('div', { class: 'field' }, h('span', {}, 'Stagioni'), seasonsSlot),
      h('div', { class: 'field' }, h('span', {}, 'Stili'), stylesSlot),
      h('div', { class: 'two' }, field('Marca', f.brand), field('Taglia', f.size)),
      field('Note', f.notes),
      h('div', { class: 'row end' },
        isNew ? null : h('button', { class: 'btn danger', type: 'button', onclick: del }, 'Elimina'),
        isNew ? null : h('button', { class: 'btn', type: 'button', onclick: runAI }, 'Rianalizza con AI'),
        h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Salva')),
    ].filter(Boolean));
    if (isNew) setTimeout(runAI, 0);
    return wrap;
  });
}

// ---------- Outfit del giorno ----------

const outfitState = { mood: 'rilassato', occasion: 'tempo_libero', weather: null, weatherError: null, results: null, extra: '' };

async function renderOutfit() {
  titleEl.textContent = 'Outfit del giorno';
  view.replaceChildren();
  const items = await db.getAll('items');

  if (items.length < 3) {
    view.append(h('div', { class: 'empty' },
      h('strong', {}, 'Servono almeno 3 capi'),
      'Aggiungi qualche capo nell\'Armadio e poi torna qui per le proposte di outfit.',
      h('div', { class: 'spacer' }),
      h('a', { class: 'btn primary', href: '#/armadio' }, 'Vai all\'Armadio')));
    return;
  }

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

  const extra = h('input', { type: 'text', value: outfitState.extra, placeholder: 'es. voglio usare la giacca verde' });
  extra.addEventListener('input', () => { outfitState.extra = extra.value; });

  const resultsBox = h('div');
  const go = h('button', { class: 'btn primary block', type: 'button' }, 'Proponimi 3 outfit');
  go.addEventListener('click', async () => {
    go.disabled = true;
    resultsBox.replaceChildren(h('div', { class: 'status' }, h('span', { class: 'spinner' }), 'Sto abbinando i tuoi capi…'));
    try {
      const [profile, history] = await Promise.all([db.getKV('profile'), db.getAll('outfits')]);
      history.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      outfitState.results = await suggestOutfits({
        items, profile, history,
        mood: outfitState.mood, occasion: outfitState.occasion,
        weather: outfitState.weather, extra: outfitState.extra.trim(),
      });
      paintResults(resultsBox, items);
    } catch (e) {
      resultsBox.replaceChildren(h('p', { class: 'error' }, e.message));
    } finally {
      go.disabled = false;
    }
  });

  view.append(
    weatherBox,
    h('h2', {}, 'Come ti senti oggi?'),
    chipGroup(MOODS, outfitState.mood, { onChange: (v) => { outfitState.mood = v; } }),
    h('h2', {}, 'Per cosa ti vesti?'),
    chipGroup(OCCASIONS, outfitState.occasion, { onChange: (v) => { outfitState.occasion = v; } }),
    field('Qualcosa in più? (facoltativo)', extra),
    go,
    h('div', { class: 'spacer' }),
    resultsBox,
  );

  if (!(await hasKey())) {
    resultsBox.replaceChildren(h('p', { class: 'hint' }, 'Per le proposte serve la chiave API: aggiungila nelle impostazioni (icona in alto a destra).'));
  } else if (outfitState.results) {
    paintResults(resultsBox, items);
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
      h('div', { class: 'pieces' }, o.item_ids.map((id) => {
        const it = byId[id];
        return h('figure', {}, h('img', { src: imgURL(it), alt: describeItem(it) }), h('figcaption', {}, it.subcategory || CATEGORIES[it.category]));
      })),
      o.missing ? h('p', { class: 'missing' }, `Per completarlo: ${o.missing}`) : null,
      h('div', { class: 'row' }, up, down, h('span', { style: 'flex:1' }), wear)));
  }
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
    field('Altre note per lo stylist', f.notes),
    h('button', { class: 'btn primary block', type: 'button', onclick: save }, 'Salva profilo'),
  );
}

// ---------- Impostazioni ----------

async function openSettings() {
  const s = await getSettings();
  openDialog((close) => {
    const key = h('input', { type: 'password', value: s.apiKey || '', placeholder: 'sk-ant-…', autocomplete: 'off' });
    const model = select({
      'claude-sonnet-5-5': 'Claude Sonnet 5.5 (consigliato)',
      'claude-haiku-5-5': 'Claude Haiku 5.5 (più economico)',
    }, s.model || DEFAULT_MODEL);
    const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });

    const save = async () => {
      await db.setKV('settings', { ...s, apiKey: key.value.trim(), model: model.value });
      close();
      toast('Impostazioni salvate');
      route();
    };

    const doExport = async () => {
      const data = await db.exportBackup();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `dress-backup-${new Date().toISOString().slice(0, 10)}.json` });
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
        toast(`Ripristinati ${n} capi`);
        close();
        route();
      } catch (e) {
        toast(e.message || 'Backup non valido');
      }
    });

    return h('div', { class: 'sheet' },
      sheetHead('Impostazioni', close),
      h('h2', {}, 'AI'),
      h('p', { class: 'hint', html: 'Crea una chiave su <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> e incollala qui. Resta salvata solo su questo telefono.' }),
      field('Chiave API Anthropic', key),
      field('Modello', model),
      h('button', { class: 'btn primary block', type: 'button', onclick: save }, 'Salva'),
      h('h2', {}, 'Backup'),
      h('p', { class: 'hint' }, 'Armadio, outfit e profilo sono salvati solo su questo telefono. Scarica un backup ogni tanto per non perderli.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: doExport }, 'Scarica backup'),
        h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, 'Ripristina backup')),
      fileIn,
    );
  });
}

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
route();
db.askPersistence();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
