// Filters the DoBIH master CSV down to the 282 Munros and emits a small
// JSON file the app bundles for offline use.
//
// Source: Database of British and Irish Hills (DoBIH), v18.4
// https://www.hill-bagging.co.uk/dobih/ — Creative Commons Attribution 4.0
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

const SOURCE = new URL('./dobih-source/DoBIH_v18_4.csv', import.meta.url);
const OUT = new URL('../public/data/munros.json', import.meta.url);

const csv = readFileSync(SOURCE, 'utf-8');
const rows = parse(csv, { columns: true });

const munros = rows
  .filter((row) => row.M === '1')
  .map((row) => ({
    number: Number(row.Number),
    name: row.Name,
    heightM: Number(row.Metres),
    lat: Number(row.Latitude),
    lon: Number(row.Longitude),
  }))
  .sort((a, b) => a.heightM - b.heightM);

if (munros.length !== 282) {
  throw new Error(`Expected 282 Munros, got ${munros.length}`);
}

writeFileSync(OUT, JSON.stringify(munros));
console.log(`Wrote ${munros.length} Munros to ${OUT.pathname}`);
