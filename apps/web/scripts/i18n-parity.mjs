#!/usr/bin/env node
/**
 * Phase 0 / Feature 1 — i18n key-parity check.
 *
 * Walks `src/i18n/ro/*.json` and `src/i18n/en/*.json`, deep-flattens each
 * to a `set<string>` of dotted keypaths, and fails (exit 1) if any
 * namespace shows divergence in either direction.
 *
 * Why pure-node (not vitest): runs in CI BEFORE pnpm install needs to
 * pull the workspace's dev deps. Vitest would add ~3-5s to the gate; this
 * is ~60ms.
 *
 * Usage:
 *   node apps/web/scripts/i18n-parity.mjs
 *   pnpm --filter @amass/web i18n:parity
 *
 * Output: on success, a one-line OK; on failure, a per-namespace diff with
 * "only-in-RO" + "only-in-EN" key lists capped at 25 each (full lists in
 * verbose mode via I18N_PARITY_VERBOSE=1).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const I18N_ROOT = path.resolve(HERE, '../src/i18n');
const VERBOSE = process.env.I18N_PARITY_VERBOSE === '1';
const MAX_DIFFS_DISPLAYED = VERBOSE ? Infinity : 25;

/** Recursively flatten a JSON tree to dotted keys. Leaves are strings. */
function flatten(node, prefix = '', out = new Set()) {
  if (node === null || typeof node !== 'object') {
    out.add(prefix);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

async function loadNamespace(locale, ns) {
  const file = path.join(I18N_ROOT, locale, `${ns}.json`);
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function listNamespaces(locale) {
  const dir = path.join(I18N_ROOT, locale);
  const files = await fs.readdir(dir);
  return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
}

function diff(a, b) {
  const onlyA = [];
  for (const k of a) if (!b.has(k)) onlyA.push(k);
  return onlyA;
}

function format(diffs, label) {
  const head = diffs.slice(0, MAX_DIFFS_DISPLAYED);
  const overflow = diffs.length - head.length;
  return [
    `      ${label} (${diffs.length}):`,
    ...head.map((k) => `        - ${k}`),
    overflow > 0 ? `        … +${overflow} more (re-run with I18N_PARITY_VERBOSE=1)` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

async function main() {
  const roNs = new Set(await listNamespaces('ro'));
  const enNs = new Set(await listNamespaces('en'));

  let failed = false;

  const missingInEn = [...roNs].filter((n) => !enNs.has(n));
  const missingInRo = [...enNs].filter((n) => !roNs.has(n));
  if (missingInEn.length || missingInRo.length) {
    console.error('[i18n-parity] Namespace file mismatch:');
    if (missingInEn.length) console.error(`  Missing in en/: ${missingInEn.join(', ')}`);
    if (missingInRo.length) console.error(`  Missing in ro/: ${missingInRo.join(', ')}`);
    failed = true;
  }

  const sharedNs = [...roNs].filter((n) => enNs.has(n)).sort();
  let totalKeys = 0;
  let totalDiffs = 0;
  for (const ns of sharedNs) {
    const [ro, en] = await Promise.all([loadNamespace('ro', ns), loadNamespace('en', ns)]);
    const roKeys = flatten(ro);
    const enKeys = flatten(en);
    totalKeys += roKeys.size;
    const onlyInRo = diff(roKeys, enKeys);
    const onlyInEn = diff(enKeys, roKeys);
    if (onlyInRo.length || onlyInEn.length) {
      failed = true;
      totalDiffs += onlyInRo.length + onlyInEn.length;
      console.error(`  [${ns}] drift detected:`);
      if (onlyInRo.length) console.error(format(onlyInRo, 'only in ro/'));
      if (onlyInEn.length) console.error(format(onlyInEn, 'only in en/'));
    }
  }

  if (failed) {
    console.error(
      `\n[i18n-parity] FAILED — ${totalDiffs} divergent keys across ${sharedNs.length} namespaces.`,
    );
    console.error('Fix: add the missing key to the divergent file (use "[TODO-EN] <ro-text>" for English placeholders).');
    process.exit(1);
  }

  console.log(
    `[i18n-parity] OK — ${sharedNs.length} namespaces, ${totalKeys} keys, RO↔EN parity perfect.`,
  );
}

main().catch((err) => {
  console.error('[i18n-parity] crash:', err);
  process.exit(2);
});
