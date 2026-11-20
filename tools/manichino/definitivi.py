#!/usr/bin/env python3
"""Copia nel codice dell'app i manichini che l'amministratore ha reso definitivi.

Legge il catalogo pubblico su Supabase (stessa chiave pubblica dell'app, in web/js/config.js),
prende le righe con data.definitivo = true che non sono ancora nella collezione e:
  - scarica web/img/manichino/collezione/<id>.jpg e <id>-zone.png
  - aggiunge i dati a web/img/manichino/collezione.json
Poi l'app dell'amministratore, vedendoli nella collezione, li toglie dal catalogo e dai suoi.
Lo lancia l'azione .github/workflows/definitivi.yml; a mano: python3 tools/manichino/definitivi.py
Scrive "changed=true|false" in $GITHUB_OUTPUT.
"""
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / 'web'
DIR = WEB / 'img' / 'manichino' / 'collezione'
LIST = WEB / 'img' / 'manichino' / 'collezione.json'
META = ['name', 'gender', 'occasions', 'garments', 'main', 'createdAt']
SAFE_ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')


def config():
    text = (WEB / 'js' / 'config.js').read_text(encoding='utf-8')
    val = lambda k: (re.search(rf"export const {k} = '([^']*)'", text) or [None, ''])[1]
    if val('CATALOGO_URL') and val('CATALOGO_KEY'):
        return val('CATALOGO_URL').rstrip('/'), val('CATALOGO_KEY')
    return val('SUPABASE_URL').rstrip('/'), val('SUPABASE_ANON_KEY')


def get(url, key=None):
    headers = {'apikey': key, 'Authorization': f'Bearer {key}'} if key else {}
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as r:
        return r.read()


def output(changed):
    out = os.environ.get('GITHUB_OUTPUT')
    if out:
        with open(out, 'a') as f:
            f.write(f'changed={"true" if changed else "false"}\n')


def main():
    url, key = config()
    if not url or not key:
        print('Nessun progetto Supabase in web/js/config.js')
        output(False)
        return
    rows = json.loads(get(f'{url}/rest/v1/manichini?select=id,data,modified', key))
    have = json.loads(LIST.read_text(encoding='utf-8')) if LIST.exists() else []
    known = {m['id'] for m in have}
    added = []
    for r in rows:
        data = r.get('data') or {}
        mid = str(r.get('id', ''))
        if not data.get('definitivo') or mid in known:
            continue
        if not SAFE_ID.match(mid):
            print(f'Salto un id non valido: {mid!r}')
            continue
        if data.get('gender') not in ('uomo', 'donna'):
            print(f'Salto {mid}: genere mancante')
            continue
        DIR.mkdir(parents=True, exist_ok=True)
        files = {f'{mid}.jpg': f'{mid}-base.jpg', f'{mid}-zone.png': f'{mid}-zone.png'}
        for dest, src in files.items():
            (DIR / dest).write_bytes(get(f'{url}/storage/v1/object/public/manichini/{src}'))
        entry = {'id': mid, **{k: data.get(k) for k in META}}
        have.append(entry)
        known.add(mid)
        added.append(entry)
        print(f'Aggiunto: {entry["name"]} ({entry["gender"]})')
    if added:
        LIST.write_text(json.dumps(have, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    else:
        print('Nessun manichino nuovo da rendere definitivo')
    output(bool(added))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f'Errore: {e}', file=sys.stderr)
        sys.exit(1)
