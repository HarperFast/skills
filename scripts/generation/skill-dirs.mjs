// Print the skill directories the generator writes to, one per line.
//
// The auto-sync workflow needs this list to stage and diff the generated
// output. Reading it from lib/manifest.mjs keeps SKILLS the single registry —
// adding a skill there is enough, with no per-skill plumbing in the workflow.

import process from 'node:process';

import { SKILLS } from './lib/manifest.mjs';

const dirs = SKILLS.map((s) => s.dir);

// Guard against a malformed registry silently producing an empty stage list,
// which would make the workflow report "no changes" for every run.
if (dirs.length === 0 || dirs.some((d) => typeof d !== 'string' || d.length === 0)) {
	console.error('skill-dirs: SKILLS in lib/manifest.mjs has no usable `dir` entries');
	process.exit(1);
}

console.log(dirs.join('\n'));
