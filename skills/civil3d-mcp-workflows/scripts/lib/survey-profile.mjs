// Survey layer profile resolver for the Fase 1 engine. Roles (centerline, propertyLine, rwDimLayers, pavementEdge, freezeXrefLayers)
// live in references/standards/survey-profiles.json; this picks the profile that matches an X-TOPO dump.
//   import { loadProfiles, pickProfile, profileByName } from './lib/survey-profile.mjs'
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROFILES_FILE = path.join(here, '../../references/standards/survey-profiles.json');

export function loadProfiles(file = PROFILES_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).profiles;
}

export function profileByName(name, profiles = loadProfiles()) {
  const p = profiles[name];
  if (!p) throw new Error(`unknown survey profile "${name}" (known: ${Object.keys(profiles).join(', ')})`);
  return { name, ...p };
}

// ents: dump entities already filtered to the site window ({ type, layer }). `forced` = project.json sources.surveyProfile.
export function pickProfile(ents, forced, profiles = loadProfiles()) {
  if (forced) return profileByName(forced, profiles);
  const hits = {};
  for (const [name, p] of Object.entries(profiles)) {
    hits[name] = ents.filter((e) => e.type === 'LINE' && p.centerline.includes(e.layer)).length;
    if (hits[name] > 0) return { name, ...p };
  }
  throw new Error(`no survey profile matches: no LINE entity on any known centerline layer in the window (${Object.entries(profiles).map(([n, p]) => `${n}: ${p.centerline.join('/')}`).join('; ')}). Add a profile to references/standards/survey-profiles.json`);
}
