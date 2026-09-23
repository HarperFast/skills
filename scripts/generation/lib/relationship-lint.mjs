// Consistency checks for `@relationship` examples in Markdown.
//
// Encodes how Harper resolves a relationship (harper resources/Table.ts and
// resources/search.ts):
//   - `from: X` names an attribute of the enclosing type, `to: Y` one of the
//     field's target type. Names are used verbatim, so a misspelled one
//     resolves to nothing, silently.
//   - `to:` requires a list field type; otherwise Harper logs an error and
//     never resolves the field.
//   - The relationship is many-to-many exactly when the referenced attribute
//     is a list: X for the `from`-only form, Y whenever `to` is set.
//   - `@relation` is not a Harper directive; unknown directives are ignored
//     without a warning (resources/graphql.ts), so it is checked as a typo.
//
// Every check is conservative, because a false positive blocks an otherwise
// correct docs sync: anything an example does not show outright (a type
// defined only in another fence, an elided or unparseable body, conflicting
// definitions, prose that could describe more than one relationship) is
// treated as unknown and skipped.

import { splitFencedBlocks } from './sources.mjs';

// Placed on the last line before a fence to exempt a deliberate counter-example.
export const IGNORE_MARKER = '<!-- lint-relationships: ignore -->';

const MANY_TO_MANY = 'many-to-many';
const MANY_TO_ONE = 'many-to-one';
const ONE_TO_MANY = 'one-to-many';
const ONE_TO_ONE = 'one-to-one';

const NAME_START_RE = /[A-Za-z_]/;
const NAME_CHAR_RE = /[A-Za-z0-9_]/;
const PUNCTUATION = '{}()[]:!@=,&|;<>';

const CLAIM_RE = /\b(one|many)(?:-|\s+)to(?:-|\s+)(one|many)\b/gi;
// Up to two words between the negation and the claim: "not a many-to-many".
const NEGATION_RE =
	/\b(?:not|never|no|unlike|isn't|aren't|cannot|can't|rather\s+than|instead\s+of)\s+(?:[\w`'-]+\s+){0,2}$/i;
const HEADING_RE = /^\s{0,3}#{1,6}\s/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s/;

// Linear single pass: fence contents are arbitrary text and must not backtrack.
function tokenize(code) {
	const tokens = [];
	const comments = new Map(); // line -> comment text; a line holds at most one
	let line = 0;
	let i = 0;
	while (i < code.length) {
		const ch = code[i];
		if (ch === '\n') {
			line++;
			i++;
		} else if (ch === '#') {
			let end = code.indexOf('\n', i);
			if (end === -1) end = code.length;
			comments.set(line, code.slice(i + 1, end));
			i = end;
		} else if (ch === '"') {
			const startLine = line;
			let value;
			if (code.startsWith('"""', i)) {
				let end = code.indexOf('"""', i + 3);
				if (end === -1) end = code.length;
				value = code.slice(i + 3, end);
				for (let j = i + 3; j < end; j++) if (code[j] === '\n') line++;
				i = end + 3;
			} else {
				let end = i + 1;
				while (end < code.length && code[end] !== '"' && code[end] !== '\n') {
					end += code[end] === '\\' ? 2 : 1;
				}
				value = code.slice(i + 1, end);
				i = code[end] === '"' ? end + 1 : end;
			}
			tokens.push({ kind: 'string', value, line: startLine });
		} else if (NAME_START_RE.test(ch)) {
			let end = i + 1;
			while (end < code.length && NAME_CHAR_RE.test(code[end])) end++;
			tokens.push({ kind: 'name', value: code.slice(i, end), line });
			i = end;
		} else if (code.startsWith('...', i) || ch === '…') {
			tokens.push({ kind: 'punct', value: '...', line });
			i += ch === '…' ? 1 : 3;
		} else if (PUNCTUATION.includes(ch)) {
			tokens.push({ kind: 'punct', value: ch, line });
			i++;
		} else {
			i++;
		}
	}
	return { tokens, comments };
}

const isPunct = (token, value) => token?.kind === 'punct' && token.value === value;

function skipGroup(tokens, i, open, close) {
	let depth = 0;
	for (; i < tokens.length; i++) {
		if (isPunct(tokens[i], open)) depth++;
		else if (isPunct(tokens[i], close) && --depth === 0) return i + 1;
	}
	return -1;
}

function parseTypeRef(tokens, i) {
	let depth = 0;
	while (isPunct(tokens[i], '[')) {
		depth++;
		i++;
	}
	if (tokens[i]?.kind !== 'name') return null;
	const base = tokens[i++].value;
	if (isPunct(tokens[i], '!')) i++;
	for (let d = 0; d < depth; d++) {
		if (!isPunct(tokens[i], ']')) return null;
		i++;
		if (isPunct(tokens[i], '!')) i++;
	}
	return { base, list: depth > 0, next: i };
}

// `@relationship(from: x, to: "y")` starting at the `(`. Other arguments are
// ignored; a value that is not a name or string leaves that argument unset.
function parseRelationshipArgs(tokens, i) {
	const end = skipGroup(tokens, i, '(', ')');
	if (end === -1) return null;
	const args = {};
	for (let j = i + 1; j < end - 1; j++) {
		const key = tokens[j];
		if (key.kind !== 'name' || !isPunct(tokens[j + 1], ':')) continue;
		const value = tokens[j + 2];
		if (key.value !== 'from' && key.value !== 'to') continue;
		if (value?.kind === 'name' || value?.kind === 'string') args[key.value] = value.value;
	}
	return { args, next: end, endLine: tokens[end - 1].line };
}

// Parse the field list of a type body starting just after `{`. Returns the
// index after the closing `}`; sets `type.unknown` if the body is elided or
// not plain SDL, in which case attribute absence cannot be concluded.
function parseTypeBody(tokens, i, type) {
	while (i < tokens.length && !isPunct(tokens[i], '}')) {
		const token = tokens[i];
		if (isPunct(token, '...')) {
			type.unknown = true;
			i++;
			continue;
		}
		if (token.kind === 'string') {
			i++;
			continue;
		}
		const fieldName = token.kind === 'name' ? token.value : null;
		let j = i + 1;
		if (isPunct(tokens[j], '(')) j = skipGroup(tokens, j, '(', ')');
		const ref =
			fieldName && j !== -1 && isPunct(tokens[j], ':') ? parseTypeRef(tokens, j + 1) : null;
		if (!ref) {
			type.unknown = true;
			const close = skipGroup(tokens, type.open, '{', '}');
			return close === -1 ? tokens.length : close;
		}
		const field = { name: fieldName, base: ref.base, list: ref.list };
		j = ref.next;
		while (isPunct(tokens[j], '@') && tokens[j + 1]?.kind === 'name') {
			const directive = tokens[j + 1].value;
			j += 2;
			if (!isPunct(tokens[j], '(')) continue;
			if (directive === 'relationship' || directive === 'relation') {
				const parsed = parseRelationshipArgs(tokens, j);
				if (!parsed) {
					type.unknown = true;
					return tokens.length;
				}
				if (parsed.args.from || parsed.args.to) {
					type.relationships.push({
						directive,
						field,
						type,
						...parsed.args,
						line: tokens[j - 2].line,
						endLine: parsed.endLine,
					});
				}
				j = parsed.next;
			} else {
				j = skipGroup(tokens, j, '(', ')');
				if (j === -1) {
					type.unknown = true;
					return tokens.length;
				}
			}
		}
		type.fields.set(fieldName, type.fields.has(fieldName) ? null : field);
		i = j;
	}
	if (i >= tokens.length) {
		type.unknown = true; // the fence ends inside the body
		return i;
	}
	type.closeLine = tokens[i].line;
	return i + 1;
}

// Object type definitions in one fence. Anything else — `extend type`, a
// TypeScript `type X = ...`, JavaScript — is not a Harper schema and is skipped.
function parseTypes(code) {
	const { tokens, comments } = tokenize(code);
	const types = [];
	let i = 0;
	while (i < tokens.length) {
		const token = tokens[i];
		const isDefinition =
			token.kind === 'name' &&
			token.value === 'type' &&
			tokens[i + 1]?.kind === 'name' &&
			tokens[i - 1]?.value !== 'extend';
		if (!isDefinition) {
			i++;
			continue;
		}
		let j = i + 2;
		while (j !== -1 && j < tokens.length && !isPunct(tokens[j], '{')) {
			const t = tokens[j];
			if (isPunct(t, '(')) j = skipGroup(tokens, j, '(', ')');
			else if (t.kind === 'name' || isPunct(t, '@') || isPunct(t, '&')) j++;
			else j = -1;
		}
		if (j === -1 || j >= tokens.length) {
			i += 2;
			continue;
		}
		const type = {
			name: tokens[i + 1].value,
			open: j,
			openLine: tokens[j].line,
			fields: new Map(),
			relationships: [],
			unknown: false,
		};
		i = parseTypeBody(tokens, j + 1, type);
		for (let line = type.openLine; line <= type.closeLine; line++) {
			if (/\.\.\.|…/.test(comments.get(line) ?? '')) type.unknown = true;
		}
		for (const relationship of type.relationships) {
			relationship.comment = comments.get(relationship.endLine) ?? '';
		}
		types.push(type);
	}
	return types;
}

function claimsIn(text) {
	const claims = [];
	for (const match of text.matchAll(CLAIM_RE)) {
		const before = text.slice(Math.max(0, match.index - 60), match.index);
		if (NEGATION_RE.test(before)) continue;
		claims.push({
			kind: `${match[1].toLowerCase()}-to-${match[2].toLowerCase()}`,
			index: match.index,
		});
	}
	return claims;
}

// The paragraph immediately before a fence, cut at the last heading or list
// item start inside it. Earlier paragraphs may describe a different example.
function proseContext(lines) {
	let end = lines.length;
	while (end > 0 && lines[end - 1].trim() === '') end--;
	let start = end;
	while (start > 0 && lines[start - 1].trim() !== '') start--;
	for (let i = end - 1; i >= start; i--) {
		if (HEADING_RE.test(lines[i]) || LIST_ITEM_RE.test(lines[i])) {
			start = i;
			break;
		}
	}
	return lines.slice(start, end).join(' ').replace(/\s+/g, ' ').trim();
}

function lastNonBlank(lines) {
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i].trim() !== '') return lines[i].trim();
	}
	return '';
}

// Definitions of `name`: those in the same fence win; otherwise any in the
// file. Absence can only be concluded from a complete, same-fence definition.
function resolveType(name, fence, fileTypes) {
	const local = fence.types.filter((t) => t.name === name);
	const definitions = local.length > 0 ? local : (fileTypes.get(name) ?? []);
	if (definitions.length === 0) return null;
	return {
		name,
		definitions,
		absenceKnown: local.length > 0 && !local.some((t) => t.unknown),
	};
}

function attributeShape(resolved, attribute) {
	if (!resolved) return null;
	const fields = resolved.definitions.map((t) => t.fields.get(attribute));
	if (fields.includes(null)) return null; // declared twice in one type
	const found = fields.filter(Boolean);
	if (found.length === 0) return resolved.absenceKnown ? { missing: true } : null;
	return found.every((f) => f.list === found[0].list) ? { list: found[0].list } : null;
}

function describe(relationship) {
	const args = ['from', 'to']
		.filter((k) => relationship[k])
		.map((k) => `${k}: "${relationship[k]}"`)
		.join(', ');
	return `@${relationship.directive}(${args}) on ${relationship.type.name}.${relationship.field.name}`;
}

// The cardinality words a relationship's resolution supports, or null when
// its shape cannot be determined from the example. For `to:` the field's own
// list shape does not matter here; relationship-field-type reports that.
function supportedClaims(relationship, from, to) {
	const { field } = relationship;
	if (relationship.to) {
		if (to?.list === undefined) return null;
		if (relationship.from && from?.list !== false) return null;
		if (to.list)
			return { kinds: [MANY_TO_MANY], why: `${field.base}.${relationship.to} is a list` };
		const kinds = relationship.from
			? [MANY_TO_ONE, ONE_TO_MANY, ONE_TO_ONE]
			: [ONE_TO_MANY, ONE_TO_ONE];
		return { kinds, why: `${field.base}.${relationship.to} is not a list` };
	}
	if (from?.list === undefined || from.list !== field.list) return null;
	const where = `${relationship.type.name}.${relationship.from}`;
	return from.list
		? { kinds: [MANY_TO_MANY], why: `${where} is a list` }
		: { kinds: [MANY_TO_ONE, ONE_TO_ONE], why: `${where} is not a list` };
}

const isManyToMany = (kinds) => kinds.includes(MANY_TO_MANY);

function excerpt(text, index) {
	const start = Math.max(0, text.lastIndexOf('.', index) + 1, index - 80);
	const stop = text.indexOf('.', index);
	const sentence = text.slice(start, stop === -1 ? undefined : stop + 1).trim();
	return sentence.length > 140 ? `${sentence.slice(0, 137)}...` : sentence;
}

// `checked` lets a caller tell a clean document from one with no examples.
export function lintMarkdown(markdown) {
	const segments = splitFencedBlocks(markdown.replace(/\r\n?/g, '\n'), { nested: true });
	const fences = [];
	for (let s = 1; s < segments.length; s += 2) {
		const code = segments[s].lines.join('\n');
		if (!/\btype\b/.test(code)) continue;
		const prose = segments[s - 1].lines;
		if (lastNonBlank(prose) === IGNORE_MARKER) continue;
		const types = parseTypes(code);
		if (types.length > 0) {
			fences.push({ startLine: segments[s].startLine, types, context: proseContext(prose) });
		}
	}

	const fileTypes = new Map();
	for (const fence of fences) {
		for (const type of fence.types) {
			if (!fileTypes.has(type.name)) fileTypes.set(type.name, []);
			fileTypes.get(type.name).push(type);
		}
	}

	const findings = [];
	let checked = 0;
	for (const fence of fences) {
		const lineOf = (relationship) => fence.startLine + relationship.line + 1;
		const shapes = [];
		for (const type of fence.types) {
			for (const relationship of type.relationships) {
				checked++;
				const { field } = relationship;
				if (relationship.directive === 'relation') {
					findings.push({
						line: lineOf(relationship),
						rule: 'relationship-directive',
						message: `${describe(relationship)}: Harper has no @relation directive and ignores it without a warning — use @relationship`,
					});
				}
				const self = resolveType(type.name, fence, fileTypes);
				const target = resolveType(field.base, fence, fileTypes);
				const from = relationship.from ? attributeShape(self, relationship.from) : undefined;
				const to = relationship.to ? attributeShape(target, relationship.to) : undefined;

				for (const [key, shape, owner] of [
					['from', from, self],
					['to', to, target],
				]) {
					if (!shape?.missing) continue;
					const declared = [...new Set(owner.definitions.flatMap((t) => [...t.fields.keys()]))];
					findings.push({
						line: lineOf(relationship),
						rule: 'relationship-attribute',
						message: `${describe(relationship)}: type ${owner.name} declares no attribute "${relationship[key]}" (declared: ${declared.join(', ')})`,
					});
				}

				if (!field.list && (relationship.to || from?.list === true)) {
					const reason = relationship.to
						? 'Harper only resolves a relationship with `to:` on a list field'
						: `${type.name}.${relationship.from} is a list`;
					findings.push({
						line: lineOf(relationship),
						rule: 'relationship-field-type',
						message: `${describe(relationship)}: field type must be [${field.base}] — ${reason}`,
					});
				}

				const supported = supportedClaims(relationship, from, to);
				shapes.push(supported);
				if (!supported) continue;
				const stated = claimsIn(relationship.comment ?? '');
				if (stated.length > 0 && !stated.some((c) => supported.kinds.includes(c.kind))) {
					findings.push({
						line: fence.startLine + relationship.endLine + 1,
						rule: 'relationship-cardinality',
						message: `${describe(relationship)} is commented "${stated[0].kind}", but it resolves as ${supported.kinds.join(' / ')} (${supported.why})`,
					});
				}
			}
		}

		// Prose only when every relationship in the fence resolves to the same
		// many-to-many-or-not answer; otherwise the prose could be about any one.
		if (shapes.length === 0 || shapes.includes(null)) continue;
		const manyToMany = isManyToMany(shapes[0].kinds);
		if (shapes.some((shape) => isManyToMany(shape.kinds) !== manyToMany)) continue;
		const stated = claimsIn(fence.context);
		if (stated.length === 0) continue;
		if (stated.some((c) => (c.kind === MANY_TO_MANY) === manyToMany)) continue;
		const first = fence.types.find((t) => t.relationships.length > 0).relationships[0];
		findings.push({
			line: lineOf(first),
			rule: 'relationship-cardinality',
			message: `the text before this example says ${stated[0].kind} ("${excerpt(fence.context, stated[0].index)}"), but ${describe(first)} is ${manyToMany ? '' : 'not '}many-to-many (${shapes[0].why})`,
		});
	}
	findings.sort((a, b) => a.line - b.line);
	return { findings, checked };
}
