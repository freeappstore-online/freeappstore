#!/usr/bin/env node
/**
 * Runs @vibecodeqa/cli on every app in registry.json.
 * Outputs: dist/quality/<app-id>/index.html (report) + dist/quality/scores.json (summary)
 *
 * Usage: node scripts/quality-scan.js
 * Requires: git, npx, GITHUB_TOKEN or gh CLI auth
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST_QUALITY = path.join(ROOT, 'dist', 'quality');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(ROOT, 'registry.json'), 'utf8'));
const TMP = path.join(require('os').tmpdir(), 'fas-quality-scan');

// Ensure output dirs exist
fs.mkdirSync(DIST_QUALITY, { recursive: true });

const scores = {};

for (const app of REGISTRY.apps) {
  const appDir = path.join(TMP, app.id);
  const reportDir = path.join(DIST_QUALITY, app.id);
  fs.mkdirSync(reportDir, { recursive: true });

  console.log(`\n--- ${app.id} (${app.repo}) ---`);

  try {
    // Clone (shallow) or pull
    if (fs.existsSync(path.join(appDir, '.git'))) {
      execSync('git pull --ff-only', { cwd: appDir, stdio: 'pipe' });
    } else {
      fs.mkdirSync(appDir, { recursive: true });
      execSync(`git clone --depth 1 https://github.com/${app.repo}.git ${appDir}`, { stdio: 'pipe' });
    }

    // Run vibecodeqa CLI
    const jsonOut = execSync('npx --yes @vibecodeqa/cli --json 2>/dev/null', {
      cwd: appDir,
      encoding: 'utf8',
      timeout: 60000,
    });

    const report = JSON.parse(jsonOut);
    scores[app.id] = { score: report.score, grade: report.grade };

    // Generate HTML report
    execSync('npx --yes @vibecodeqa/cli 2>/dev/null || true', {
      cwd: appDir,
      timeout: 60000,
      stdio: 'pipe',
    });

    // Find and copy the HTML report
    const htmlReport = path.join(appDir, 'vibe-check-report.html');
    if (fs.existsSync(htmlReport)) {
      fs.copyFileSync(htmlReport, path.join(reportDir, 'index.html'));
      console.log(`  Score: ${report.score} (${report.grade}) — report saved`);
    } else {
      // Save JSON as fallback
      fs.writeFileSync(path.join(reportDir, 'report.json'), jsonOut);
      console.log(`  Score: ${report.score} (${report.grade}) — JSON only`);
    }
  } catch (err) {
    console.log(`  FAILED: ${err.message?.slice(0, 80)}`);
    scores[app.id] = { score: null, grade: null, error: err.message?.slice(0, 100) };
  }
}

// Write summary
fs.writeFileSync(path.join(DIST_QUALITY, 'scores.json'), JSON.stringify(scores, null, 2));
console.log(`\n\nDone. ${Object.keys(scores).length} apps scanned.`);
console.log(`Scores: ${JSON.stringify(scores, null, 2)}`);
