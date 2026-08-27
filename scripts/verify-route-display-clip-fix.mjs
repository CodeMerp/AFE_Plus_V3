#!/usr/bin/env node
// [afe.web.route_flicker] static verification for the physical route-display-clip fix.
// Read-only: never writes and never runs the app.

import { readFileSync } from 'node:fs';

const PAGE = 'src/pages/navigation.tsx';
const MODEL = 'src/lib/presentation/routeDisplayClipModel.ts';
const page = readFileSync(PAGE, 'utf8');
const model = readFileSync(MODEL, 'utf8');
const failures = [];
const check = (ok, label, detail) => {
    if (!ok) failures.push(detail ? `${label} — ${detail}` : label);
};
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const pageCode = stripComments(page);

// ── Invariant 1: line-trim-offset is invariant, never written imperatively ──────────────
check(!pageCode.includes('setPaintProperty('), 'line-trim-offset must never be written imperatively',
      'found a setPaintProperty( call — the paint-only trim mechanism must not come back');
const trimOffsetOccurrences = (pageCode.match(/"line-trim-offset":\s*\[0,\s*0\]/g) || []).length;
check(trimOffsetOccurrences === 2, 'both route layers must declare a static invariant line-trim-offset [0, 0]',
      `found ${trimOffsetOccurrences}, expected 2 (casing + main)`);

// ── Invariant 2: normal route updates never remove/recreate source or layers ────────────
for (const forbidden of ['removeLayer(', 'removeSource(', 'addLayer(', 'addSource(']) {
    check(!pageCode.includes(forbidden), `normal route update must not recreate the Mapbox source/layers: ${forbidden}`);
}
check(pageCode.includes('key={`route-${routeSourceKey}`}'),
      'the declarative Source remount key must remain scoped to routeSourceKey (first-route/Mapbox-refetch only)');

// ── Invariant 3: exactly one imperative writer of the route Source's data ───────────────
const applyFnStart = page.indexOf('const applyRouteDisplayGeometry = (');
check(applyFnStart >= 0, 'applyRouteDisplayGeometry must exist — the single imperative writer of route Source data');
const applyFnEnd = page.indexOf('const getInitialRouteTrimPosition =', applyFnStart);
const applyFnBlock = applyFnStart >= 0 && applyFnEnd > applyFnStart ? page.slice(applyFnStart, applyFnEnd) : '';
check(applyFnBlock.includes('map?.getSource ? map.getSource("route")'), 'applyRouteDisplayGeometry must target the "route" source');
check(applyFnBlock.includes('source.setData(geojson)'), 'applyRouteDisplayGeometry must physically commit via setData, not a paint property');
check(applyFnBlock.includes('return false'), 'applyRouteDisplayGeometry must report failure (not silently succeed) when the source is not ready');

const setDataOccurrences = (pageCode.match(/\.setData\(/g) || []).length;
check(setDataOccurrences === 1, 'the route Source must have exactly one setData call site (inside applyRouteDisplayGeometry)',
      `found ${setDataOccurrences}`);

// ── Invariant 4: declarative Source data is driven by the clipped display path, not the
//    full authoritative one — and camera/marker's use of the full path is untouched ───────
check(page.includes('const activeRouteSourcePath = displayRouteSourcePath;'),
      'the Mapbox Source must be fed the physically-clipped displayRouteSourcePath, not the full stableRouteSourcePath');
check(page.includes('stableRouteSourcePath, routeVersion, routeTailAnchor, status]);'),
      'renderedRoutePath (marker/camera fallback geometry) must remain keyed on the full stableRouteSourcePath — camera/marker behavior must not change');

// ── Invariant 5: steady-state MT-D* updates do not re-trigger the declarative Source write ─
const applySourcePathLegacyStart = page.indexOf('const applySourcePathLegacy = (reason: string) => {');
const applySourcePathLegacyEnd = page.indexOf('\n        };', applySourcePathLegacyStart);
const applySourcePathLegacyBlock = applySourcePathLegacyStart >= 0 && applySourcePathLegacyEnd > applySourcePathLegacyStart
    ? page.slice(applySourcePathLegacyStart, applySourcePathLegacyEnd)
    : '';
check(applySourcePathLegacyBlock.length > 0, 'applySourcePathLegacy must be present');
check(applySourcePathLegacyBlock.includes('if (sourceKeyChanged || displayRouteSourcePathRef.current.length < 2) {'),
      'applySourcePathLegacy must only seed displayRouteSourcePath React state on identity change / first paint — never unconditionally, to avoid a second writer racing the imperative one');

// ── Invariant 6: the pure clip model exists, is imported (not duplicated), and is used at
//    both call sites that used to call the old paint-only writer. ───────────────────────
check(model.includes('export function clipRoutePathAtProjection'), 'pure model missing clipRoutePathAtProjection');
check(model.includes('export function shouldCommitFreshProjection'), 'pure model missing shouldCommitFreshProjection');
check(page.includes('import { clipRoutePathAtProjection, shouldCommitFreshProjection } from "@/lib/presentation/routeDisplayClipModel";'),
      'navigation.tsx must import the pure clip model rather than redefining the logic inline');
const clipCallCount = (pageCode.match(/clipRoutePathAtProjection\(/g) || []).length;
check(clipCallCount === 2, 'clipRoutePathAtProjection must be called at exactly the two live commit sites (seed + rAF loop)',
      `found ${clipCallCount}`);

const commitGuardCount = (pageCode.match(/shouldCommitFreshProjection\(/g) || []).length;
check(commitGuardCount === 2, 'shouldCommitFreshProjection must gate both commit sites',
      `found ${commitGuardCount}`);

// ── Invariant 7: Camera/Marker/Motion/Scheduler surface must not be touched by this fix ──
const diffSensitiveForbidden = [
    'jumpTo(', 'easeTo(', 'flyTo(', 'setTimeout(',
    'snappedAgentTargetRef.current =', 'lastValidSnappedRef.current =',
    'integratorPosition', 'motionRouteVersionRef.current +=',
];
const touchedRegion = [
    applyFnBlock,
    page.slice(page.indexOf('// ── [afe.web.route_flicker] Route display geometry (physical clip) ──────'),
               page.indexOf('// ── Visual marker bearing lerp')),
].join('\n');
for (const forbidden of diffSensitiveForbidden) {
    check(!touchedRegion.includes(forbidden), `route display clip fix must not touch Camera/Marker/Motion/Scheduler behavior: ${forbidden}`);
}

if (failures.length > 0) {
    console.error(`FAIL — ${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`  x ${f}`);
    process.exit(1);
}
console.log('PASS — route display clip fix verified');
console.log('       (passed geometry physically excluded from the Source; line-trim-offset invariant; single setData writer)');
console.log('       (no source/layer recreation on normal updates; camera/marker/motion surface untouched)');
