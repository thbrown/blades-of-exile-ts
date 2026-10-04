/**
 * Pull the text out of every library scenario and flag passages that bear on a
 * content rating — for auditing the G/PG/R ratings authors gave their
 * scenarios on Spiderweb's archive. Writes `library/audit/<id>.json`: how many
 * words of text there are, and per category the matching passages with their
 * surroundings. The flags only point at what to read; they don't decide.
 * `library/audit/text/<id>.txt` is the scenario's whole text (less what most
 * scenarios share), for reading past the flags.
 *
 * Usage: npx vite-node scripts/content-audit.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Scenario } from '../src/data/scenario';
import { identifyScenarioFiles, loadScenarioPackage } from '../src/fileio/scenarioPackage';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { LibraryCatalog } from '../src/fileio/libraryCatalog';

const CATEGORIES: Record<string, RegExp> = {
  language: /\b(fuck\w*|shit\w*|bitch\w*|bastard\w*|damn\w*|goddam\w*|hell\b|ass\b|asshole\w*|piss\w*|crap\w*|dick\b|cock\b|whore\w*|slut\w*|cunt\w*|twat\w*|arse\b|bloody\b)/gi,
  sexual: /\b(sex\w*|naked|nude\w*|breast\w*|rape\w*|raped|seduc\w*|lust\w*|brothel\w*|prostitut\w*|harlot\w*|virgin\w*|orgy|orgies|erotic\w*|kiss\w*|lover\w*|bed with|undress\w*|topless|nipple\w*|mistress\w*|concubine\w*)/gi,
  drugs: /\b(drug\w*|opium|narcotic\w*|drunk\w*|ale\b|beer\b|wine\b|liquor\w*|whisk(e)?y|hangover|high on|smok\w*|weed\b|stoned|addict\w*|intoxicat\w*|booze\w*|brew\w*|mushroom\w*)/gi,
  gore: /\b(blood\w*|gore\w*|entrail\w*|gut\w*|guts|dismember\w*|decapitat\w*|severed|corpse\w*|torture\w*|tortur\w*|mutilat\w*|skin(ned|ning)|flay\w*|butcher\w*|slaughter\w*|massacre\w*|disembowel\w*|impal\w*|rotting|carcass\w*|eyeball\w*|brains?\b|skull\w*)/gi,
  dark: /\b(suicide\w*|kill (him|her|them|your)self|child(ren)? (die|dead|killed|murder\w*)|infant\w*|baby\b|babies|murder\w*|sacrific\w*|demon\w*|satan\w*|devil\w*|genocide\w*|slave\w*|cannibal\w*|abus\w*|incest\w*|necro\w*|execut\w*|hang(ed|ing)\b)/gi,
};

function allText(s: Scenario): string[] {
  const out: string[] = [s.title, ...s.teasers, ...s.introMsgs, ...s.specStrs];
  for (const item of s.specialItems) out.push(item.name, item.descr);
  for (const item of s.scenItems) out.push(item.fullName, item.name);
  for (const mon of s.scenMonsters) out.push(mon.name);
  for (const ter of s.terTypes) out.push(ter.name);
  for (const col of s.outdoors) {
    for (const sec of col) {
      out.push(sec.name, sec.comment, ...sec.specStrs);
      for (const sign of sec.signLocs) out.push(sign.text);
      for (const area of sec.areaDesc) out.push(area.descr);
    }
  }
  s.towns.forEach((town, i) => {
    out.push(town.name, ...town.comment, ...town.specStrs);
    for (const sign of town.signLocs) out.push(sign.text);
    for (const area of town.areaDesc) out.push(area.descr);
    const talk = s.townTalk[i];
    if (talk) {
      for (const p of talk.people) out.push(p.title, p.look, p.name, p.job, p.dunno);
      for (const n of talk.talkNodes) out.push(n.str1, n.str2);
    }
  });
  return [...new Set(out.map((t) => t.trim()).filter((t) => t !== ''))];
}

const opcodes = buildOpcodeTable(readFileSync('public/data/strings/specials-opcodes.txt', 'utf8'));
const catalog = JSON.parse(readFileSync('library/dist/catalog.json', 'utf8')) as LibraryCatalog;
mkdirSync('library/audit/text', { recursive: true });

// Every scenario starts from the editor's stock items, monsters and terrains
// ("Ale", "Demon", "Bloodfire Sword"…), so a string most scenarios share is
// boilerplate rather than something the author wrote. Two passes: count, then
// scan only what's left.
const perScenario = new Map<string, string[]>();
const seenIn = new Map<string, number>();
for (const entry of catalog.scenarios) {
  const zip = readFileSync(join('library/dist', entry.file));
  const pkg = identifyScenarioFiles([{ name: basename(entry.file), data: zip }]).find((p) => p.fileName === entry.package);
  if (!pkg) { console.log(`${entry.id}: not found`); continue; }
  const { scenario } = await loadScenarioPackage(pkg, opcodes);
  const texts = allText(scenario);
  perScenario.set(entry.id, texts);
  for (const t of texts) seenIn.set(t, (seenIn.get(t) ?? 0) + 1);
}
const boilerplate = (t: string): boolean => (seenIn.get(t) ?? 0) > catalog.scenarios.length / 5;

for (const entry of catalog.scenarios) {
  const texts = (perScenario.get(entry.id) ?? []).filter((t) => !boilerplate(t));
  const words = texts.join(' ').split(/\s+/).length;
  const hits: Record<string, { term: string; passage: string }[]> = {};
  const counts: Record<string, Record<string, number>> = {};
  for (const [cat, re] of Object.entries(CATEGORIES)) {
    hits[cat] = [];
    counts[cat] = {};
    for (const t of texts) {
      for (const m of t.matchAll(re)) {
        const term = m[0].toLowerCase();
        counts[cat]![term] = (counts[cat]![term] ?? 0) + 1;
        // Up to 3 passages per term, so a common word doesn't crowd out a rare one.
        if (hits[cat]!.filter((h) => h.term === term).length < 3 && hits[cat]!.length < 25) {
          const at = m.index ?? 0;
          hits[cat]!.push({ term, passage: t.slice(Math.max(0, at - 160), at + 160).replace(/\s+/g, ' ') });
        }
      }
    }
  }
  // The whole text too, one string a paragraph, for a reader to search for
  // what no list of words anticipates.
  writeFileSync(join('library/audit/text', `${entry.id}.txt`), texts.join('\n\n'));
  writeFileSync(join('library/audit', `${entry.id}.json`), JSON.stringify({
    id: entry.id, title: entry.title, listed: entry.contentRating, words, counts, hits,
    listing: entry.description,
    blurb: entry.blurb,
  }, null, 1));
}
console.log('done');
