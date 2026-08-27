#!/usr/bin/env node
// [afe.web.route_flicker] focused execution tests for the physical route-display-clip model.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const failures = [];
let assertions = 0;
const eq = (actual, expected, label) => {
    assertions += 1;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
};

const outDir = mkdtempSync(join(tmpdir(), 'route-display-clip-'));
let mod;
try {
    execFileSync('npx', [
        'tsc',
        'src/lib/presentation/routeDisplayClipModel.ts',
        '--outDir', outDir,
        '--module', 'esnext',
        '--target', 'es2020',
        '--moduleResolution', 'bundler',
        '--strict',
    ], { stdio: 'pipe' });
    mod = await import(pathToFileURL(join(outDir, 'routeDisplayClipModel.js')).href);
} catch (err) {
    console.error('FAIL — could not compile/import the real route-display-clip model');
    console.error(err.stdout?.toString?.() ?? err.message);
    rmSync(outDir, { recursive: true, force: true });
    process.exit(1);
}

const A = { lat: 13.7000, lng: 100.5000 };
const B = { lat: 13.7010, lng: 100.5000 };
const C = { lat: 13.7020, lng: 100.5000 };
const D = { lat: 13.7030, lng: 100.5000 };
const E = { lat: 13.7040, lng: 100.5000 };

// ── 1. Passed physical exclusion ─────────────────────────────────────────────
{
    const path = [A, B, C, D];
    const projected = { lat: 13.7005, lng: 100.5000 }; // between A(0) and B(1)
    const clipped = mod.clipRoutePathAtProjection(path, projected, 0);
    eq(clipped.some((p) => p.lat === A.lat && p.lng === A.lng), false,
       '1a clipped path must not contain the passed point A');
    eq(clipped[0], projected, '1b clipped path must start at the projected (frontier) point');
    eq(clipped.slice(1), [B, C, D], '1c clipped path must retain the untouched future B-C-D verbatim');
}

// ── 2. Agent advances further along the same route — start moves forward, never back ──
{
    const path = [A, B, C, D];
    const earlier = mod.clipRoutePathAtProjection(path, { lat: 13.7005, lng: 100.5000 }, 0);
    const later = mod.clipRoutePathAtProjection(path, { lat: 13.7015, lng: 100.5000 }, 1);
    eq(later.length < earlier.length, true,
       '2a advancing the frontier must strictly shrink the remaining coordinate count');
    eq(later.some((p) => p.lat === B.lat && p.lng === B.lng), false,
       '2b once passed, B must not reappear in a later, more-advanced clip');
}

// ── 3/4. Route extension / partial reroute is handled by the caller re-clipping the new
//         authoritative path fresh — clip itself is stateless per call.
{
    const oldPath = [A, B, C, D];
    const newPath = [A, B, C, E, D]; // C's outgoing edge changed (partial reroute ahead)
    const projected = { lat: 13.7015, lng: 100.5000 }; // between B(1) and C(2)
    const clippedOld = mod.clipRoutePathAtProjection(oldPath, projected, 1);
    const clippedNew = mod.clipRoutePathAtProjection(newPath, projected, 1);
    eq(clippedOld, [projected, C, D], '3a old-geometry clip keeps the old (now-stale) suffix C-D');
    eq(clippedNew, [projected, C, E, D], '4a new-geometry clip reflects the changed suffix C-E-D, not the old one');
}

// ── 5. Agent already passed history must not resurrect on a fresh authoritative path ────
{
    const newAuthoritativePath = [C, D, E]; // backend already dropped A, B
    const projected = C;
    const clipped = mod.clipRoutePathAtProjection(newAuthoritativePath, projected, 0);
    eq(clipped.some((p) => (p.lat === A.lat && p.lng === A.lng) || (p.lat === B.lat && p.lng === B.lng)), false,
       '5a passed history A/B must never appear in a clip of the new authoritative path');
}

// ── 6. Fail-closed: clipping that would collapse below 2 points returns the input unchanged ─
{
    const path = [A, B, C];
    const clipped = mod.clipRoutePathAtProjection(path, C, 2); // one past last valid segment
    eq(clipped, path, '6a a degenerate clip (< 2 points) must fail closed to the unclipped input');

    const tooShort = [A];
    eq(mod.clipRoutePathAtProjection(tooShort, A, 0), tooShort,
       '6b a path shorter than 2 points is returned unchanged');
}

// ── 7. Monotonic frontier guard (shouldCommitFreshProjection) ───────────────────────────
eq(mod.shouldCommitFreshProjection(120, 100, false), true,
   '7a forward progress on the same geometry basis commits');
eq(mod.shouldCommitFreshProjection(90, 100, false), false,
   '7b a regression on the same geometry basis must NOT commit (no passed-route resurrection)');
eq(mod.shouldCommitFreshProjection(100, 100, false), true,
   '7c an exactly-equal distance is treated as forward-safe (idempotent commit)');
eq(mod.shouldCommitFreshProjection(0, 500, true), true,
   '7d a geometry-basis change always licenses a fresh commit even if the raw distance is smaller');

rmSync(outDir, { recursive: true, force: true });
if (failures.length > 0) {
    console.error(`FAIL — ${failures.length}/${assertions} assertion(s) failed:`);
    for (const f of failures) console.error(`  x ${f}`);
    process.exit(1);
}
console.log(`PASS — route display clip model: ${assertions} assertions`);
console.log('       (passed history physically excluded; frontier never regresses within one geometry basis)');
