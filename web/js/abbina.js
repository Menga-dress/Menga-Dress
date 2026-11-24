// Quale dei tuoi manichini è di quale capo, guardando le foto.
// Un manichino fatto con ChatGPT o Gemini dalla foto di un capo ne copia la forma (un polacchino
// alto con i lacci, un mocassino basso): si ritaglia il capo dal manichino, lo si colora come il
// capo dell'armadio e lo si confronta con la foto usando lo stesso modello che riconosce i capi.
// Vale solo per i manichini che non hai già legato tu a un capo (creati dalla sua scheda o
// scelti con "Usa questo manichino"): quelli restano dove li hai messi.

import * as db from './db.js';
import { PALETTE, zoneOfCategory } from './catalog.js';
import { previewPhoto } from './look.js';
import { embed, isModelCached, typeProbs } from './riconosci.js';

const KEY = 'manichini';
const W = 640;
const H = 960;
// Legati da te: non si spostano mai da soli.
export const lockedByYou = (m) => m.itemSource === 'scheda' || m.itemSource === 'manuale';

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const mainZone = (m) => Number(Object.keys(m.garments || {}).find((k) => m.garments[k] && m.garments[k] === m.main)) || 0;

// Il capo della zona z del manichino, colorato col colore c, ritagliato.
async function garmentCrop(m, z, color) {
  const zb = await createImageBitmap(m.zone, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const zc = document.createElement('canvas');
  zc.width = W; zc.height = H;
  const zx = zc.getContext('2d', { willReadFrequently: true });
  zx.drawImage(zb, 0, 0, W, H);
  const zd = zx.getImageData(0, 0, W, H).data;
  let x0 = W; let y0 = H; let x1 = -1; let y1 = -1;
  for (let i = 0; i < W * H; i++) {
    if (Math.round(zd[i * 4] / 60) !== z) continue;
    const x = i % W; const y = (i / W) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const paint = {};
  for (const k of [1, 2, 3, 4]) paint[k] = k === z ? color : [212, 210, 205];
  const full = document.createElement('canvas');
  await previewPhoto(full, m.base, m.zone, paint);
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.1);
  const sx = Math.max(0, x0 - pad); const sy = Math.max(0, y0 - pad);
  const w = Math.min(W, x1 + pad) - sx; const h = Math.min(H, y1 + pad) - sy;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(full, sx, sy, w, h, 0, 0, w, h);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
}

// Per ogni gruppo (stesso tipo e stessa zona) con almeno un manichino da sistemare: somiglianza
// di ogni manichino con ogni capo, tolta la media del capo (alcune foto somigliano a tutto),
// e ogni manichino va al capo che gli somiglia di più.
let running = null;
export function matchByPhoto() {
  if (!running) running = run().finally(() => { running = null; });
  return running;
}

async function run() {
  if (!isModelCached()) return false;
  const list = (await db.getKV(KEY)) || [];
  const items = (await db.getAll('items')) || [];
  const groups = new Map();
  for (const m of list) {
    const z = mainZone(m);
    if (!z || !m.main || lockedByYou(m)) continue;
    const key = `${m.gender}|${z}|${m.main}`;
    if (!groups.has(key)) groups.set(key, { z, type: m.main, list: [] });
    groups.get(key).list.push(m);
  }
  let changed = false;
  for (const g of groups.values()) {
    // Capi di quel tipo, più quelli a cui i manichini sono già legati (magari col tipo cambiato).
    const its = items.filter((it) => it.image && zoneOfCategory(it.category) === g.z
      && (it.subcategory === g.type || g.list.some((m) => m.itemId === it.id)));
    if (!its.length) continue;
    // Già controllati con gli stessi capi: niente da rifare.
    const sig = its.map((it) => `${it.id}:${it.updatedAt || it.createdAt || ''}`).sort().join(',');
    const todo = g.list.filter((m) => m.photoCheck !== sig);
    if (!todo.length) continue;
    if (its.length === 1) {
      for (const m of todo) { if (m.itemId !== its[0].id) { m.itemId = its[0].id; } m.itemSource = 'foto'; m.photoCheck = sig; }
      changed = true;
      continue;
    }
    // Due confronti: l'impronta (forma e aspetto) e il tipo che il modello ci vede
    // (un polacchino resta "da polacchino" anche visto di lato sul manichino e dall'alto in foto).
    const itemEmb = [];
    const itemTypes = [];
    for (const it of its) {
      const e = await embed(it.image);
      itemEmb.push(e);
      itemTypes.push(await typeProbs(e, it.category));
    }
    const sims = [];
    for (const m of g.list) {
      const row = [];
      for (const [j, it] of its.entries()) {
        const color = PALETTE[it.colors?.[0]] || [150, 150, 150];
        const crop = await garmentCrop(m, g.z, color);
        if (!crop) { row.push(0); continue; }
        const e = await embed(crop);
        const t = await typeProbs(e, it.category);
        let same = 0;
        for (const k of Object.keys(t)) same += Math.sqrt(t[k] * (itemTypes[j][k] || 0));
        row.push(dot(e, itemEmb[j]) + 0.1 * same);
        await new Promise((r) => setTimeout(r, 20));
      }
      sims.push(row);
    }
    // Media per capo su tutti i manichini del gruppo (con un manichino solo vale la somiglianza diretta).
    const mean = its.map((_, j) => (sims.length > 1 ? sims.reduce((s, r) => s + r[j], 0) / sims.length : 0));
    g.list.forEach((m, i) => {
      let best = 0;
      for (let j = 1; j < its.length; j++) if (sims[i][j] - mean[j] > sims[i][best] - mean[best]) best = j;
      if (m.itemId !== its[best].id) changed = true;
      m.itemId = its[best].id;
      m.itemSource = 'foto';
      m.photoCheck = sig;
    });
    changed = true;
  }
  if (changed) await db.setKV(KEY, list);
  return changed;
}
