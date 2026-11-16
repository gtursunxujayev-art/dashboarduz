#!/usr/bin/env node
/**
 * ESLint ratchet for a workspace whose existing code predates its (strict) lint rules.
 *
 * Runs ESLint with the workspace's own config and compares the number of problems per file and rule with a committed
 * baseline. Any count above the baseline (a new problem, or a problem in a new file) fails. Counts below the baseline
 * are reported so the baseline can be tightened with `--update`. Rules are never relaxed here: the baseline only
 * records debt that already existed.
 *
 * Usage (from the repo root or the workspace):
 *   node scripts/lint-baseline.js apps/api            # check
 *   node scripts/lint-baseline.js apps/api --update   # rewrite apps/api/.eslint-baseline.json from the current code
 */
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const update = args.includes('--update');
const workspaceArg = args.find((arg) => !arg.startsWith('--')) || '.';
const repoRoot = path.resolve(__dirname, '..');
const workspaceDir = path.resolve(process.cwd(), workspaceArg);
const baselinePath = path.join(workspaceDir, '.eslint-baseline.json');
const patterns = ['src/**/*.ts'];

// Resolve ESLint from the workspace so its plugins and parser resolve the same way `eslint` does there.
const { ESLint } = require(require.resolve('eslint', { paths: [workspaceDir, repoRoot] }));

function toKey(filePath) {
  return path.relative(workspaceDir, filePath).split(path.sep).join('/');
}

function countProblems(results) {
  const counts = {};
  for (const result of results) {
    for (const message of result.messages) {
      const rule = message.ruleId || (message.fatal ? 'fatal-parse-error' : 'unknown');
      const file = toKey(result.filePath);
      counts[file] = counts[file] || {};
      counts[file][rule] = (counts[file][rule] || 0) + 1;
    }
  }

  return counts;
}

function sortCounts(counts) {
  const sorted = {};
  for (const file of Object.keys(counts).sort()) {
    sorted[file] = {};
    for (const rule of Object.keys(counts[file]).sort()) sorted[file][rule] = counts[file][rule];
  }

  return sorted;
}

function total(counts) {
  return Object.values(counts).reduce(
    (sum, rules) => sum + Object.values(rules).reduce((inner, value) => inner + value, 0),
    0,
  );
}

async function main() {
  const eslint = new ESLint({ cwd: workspaceDir });
  const results = await eslint.lintFiles(patterns);
  const current = sortCounts(countProblems(results));

  if (update) {
    fs.writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`Wrote ${path.relative(repoRoot, baselinePath)}: ${total(current)} known problems.`);

    return;
  }

  if (!fs.existsSync(baselinePath)) {
    console.error(`No baseline at ${path.relative(repoRoot, baselinePath)}. Create one with --update.`);
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

  const regressions = [];
  const improvements = [];
  for (const [file, rules] of Object.entries(current)) {
    for (const [rule, count] of Object.entries(rules)) {
      const allowed = (baseline[file] && baseline[file][rule]) || 0;
      if (count > allowed) regressions.push({ file, rule, count, allowed });
    }
  }
  for (const [file, rules] of Object.entries(baseline)) {
    for (const [rule, allowed] of Object.entries(rules)) {
      const count = (current[file] && current[file][rule]) || 0;
      if (count < allowed) improvements.push({ file, rule, count, allowed });
    }
  }

  console.log(`ESLint ratchet for ${path.relative(repoRoot, workspaceDir) || '.'}: ${total(current)} problems, baseline ${total(baseline)}.`);

  if (improvements.length) {
    console.log(`\n${improvements.length} file/rule pair(s) improved on the baseline. Lock it in with:`);
    console.log(`  node scripts/lint-baseline.js ${path.relative(repoRoot, workspaceDir)} --update`);
  }

  if (regressions.length) {
    const formatter = await eslint.loadFormatter('stylish');
    const regressedFiles = new Set(regressions.map((item) => item.file));
    const regressedRules = new Set(regressions.map((item) => `${item.file}::${item.rule}`));
    const relevant = results
      .filter((result) => regressedFiles.has(toKey(result.filePath)))
      .map((result) => ({
        ...result,
        messages: result.messages.filter((message) => regressedRules.has(`${toKey(result.filePath)}::${message.ruleId || 'unknown'}`)),
      }));
    console.error(`\nNew lint problems (more than the baseline allows):`);
    for (const item of regressions) {
      console.error(`  ${item.file}  ${item.rule}: ${item.count} (baseline ${item.allowed})`);
    }
    console.error(await formatter.format(relevant));
    console.error('Fix the new problems above. The baseline records old debt only; do not raise it to pass CI.');
    process.exit(1);
  }

  console.log('No new lint problems.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
