// Tests for the @relationship example lint. Run with `npm test` (node --test).
//
// The historical fixtures are verbatim excerpts of text that shipped (or was
// about to), so each test pins the rule that would have caught it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IGNORE_MARKER, lintMarkdown } from './relationship-lint.mjs';

const md = (...lines) => lines.join('\n');
const rulesOf = (markdown) => lintMarkdown(markdown).findings.map((f) => `${f.line}:${f.rule}`);

// documentation@dbb3c182 reference/rest/querying.md — documentation#582 bug 1.
const DOCS_582_QUERYING = md(
	'### Many-to-Many Relationships',
	'',
	'Many-to-many relationships can be modeled with an array of foreign key values, without a junction table:',
	'',
	'```graphql',
	'type Product @table @export {',
	'\tid: Long @primaryKey',
	'\tname: String',
	'\tresellerIds: [Long] @indexed',
	'\tresellers: [Reseller] @relationship(from: "resellerId")',
	'}',
	'```',
);

// documentation@dbb3c182 reference/database/schema.md — documentation#582 bug 2.
const DOCS_582_SCHEMA = md(
	'### `@relationship(from: attribute, to: attribute)` — foreign key to foreign key',
	'',
	'Both `from` and `to` can be specified together to define a relationship where neither side uses the primary key — a foreign key to foreign key join. This is useful for many-to-many relationships that join on non-primary-key attributes.',
	'',
	'```graphql',
	'type OrderItem @table @export {',
	'\tid: Long @primaryKey',
	'\torderId: Long @indexed',
	'\tproductSku: Long @indexed',
	'\tproduct: Product @relationship(from: productSku, to: sku) # join on sku, not primary key',
	'}',
	'',
	'type Product @table @export {',
	'\tid: Long @primaryKey',
	'\tsku: Long @indexed',
	'\tname: String',
	'}',
	'```',
);

// The same section after documentation#602.
const DOCS_602_SCHEMA = md(
	'### `@relationship(from: attribute, to: attribute)` — foreign key to foreign key',
	'',
	"Both `from` and `to` can be specified together to define a relationship where neither side uses the primary key — a foreign key to foreign key join. As with the `to`-only form above, the result type must be an array: Harper resolves it by searching the target table's `to` attribute for matches, using this record's `from` attribute (instead of its primary key) as the search value.",
	'',
	'```graphql',
	'type OrderItem @table @export {',
	'\tid: Long @primaryKey',
	'\torderId: Long @indexed',
	'\tproductSku: Long @indexed',
	'\tproducts: [Product] @relationship(from: productSku, to: sku) # matches products by sku, not primary key',
	'}',
	'',
	'type Product @table @export {',
	'\tid: Long @primaryKey',
	'\tsku: Long @indexed',
	'\tname: String',
	'}',
	'```',
);

// skills#70 review head ffc7a48 harper-best-practices/rules/defining-relationships.md.
const SKILLS_70_ITEM_3 = md(
	'3. **Use `@relationship(from: attribute, to: attribute)` for foreign key-to-foreign key joins**: Specify both `from` and `to` when neither side of the join uses the primary key. This supports many-to-many relationships on non-primary-key attributes.',
	'',
	'   ```graphql',
	'   type OrderItem @table @export {',
	'   \tid: Long @primaryKey',
	'   \torderId: Long @indexed',
	'   \tproductSku: Long @indexed',
	'   \tproduct: Product @relationship(from: productSku, to: sku)',
	'   }',
	'',
	'   type Product @table @export {',
	'   \tid: Long @primaryKey',
	'   \tsku: Long @indexed',
	'   \tname: String',
	'   }',
	'   ```',
);

// skills#44 351e28f harper-best-practices/rules/querying-rest-apis.md.
const SKILLS_44_QUERYING = md(
	'**Many-to-many relationship query:**',
	'',
	'```graphql',
	'type Product @table @export {',
	'\tid: Long @primaryKey',
	'\tname: String',
	'\tresellerIds: [Long] @indexed',
	'\tresellers: [Reseller] @relation(from: "resellerId")',
	'}',
	'```',
);

// The from-only and to-only examples as they ship today.
const CURRENT_FROM_AND_TO = md(
	'1. **Use `@relationship(from: attribute)` for many-to-one or many-to-many**: Place this on the field in the table that holds the foreign key.',
	'',
	'   ```graphql',
	'   type RealityShow @table @export {',
	'   \tid: Long @primaryKey',
	'   \tnetworkId: Long @indexed',
	'   \tnetwork: Network @relationship(from: networkId) # many-to-one',
	'   \ttitle: String @indexed',
	'   }',
	'   ```',
	'',
	'   If the foreign key attribute is an array, the relationship becomes many-to-many:',
	'',
	'   ```graphql',
	'   type RealityShow @table @export {',
	'   \tid: Long @primaryKey',
	'   \tnetworkIds: [Long] @indexed',
	'   \tnetworks: [Network] @relationship(from: networkIds)',
	'   }',
	'   ```',
	'',
	'2. **Use `@relationship(to: attribute)` for one-to-many or many-to-many**: The result type **must** be an array.',
	'',
	'   ```graphql',
	'   type Network @table @export {',
	'   \tid: Long @primaryKey',
	'   \tshows: [RealityShow] @relationship(to: networkId) # one-to-many',
	'   }',
	'   ```',
);

test('documentation#582 bug 1: from names an attribute the type does not declare', () => {
	const { findings } = lintMarkdown(DOCS_582_QUERYING);
	assert.deepEqual(
		findings.map((f) => `${f.line}:${f.rule}`),
		['10:relationship-attribute'],
	);
	assert.match(findings[0].message, /declares no attribute "resellerId"/);
});

test('documentation#582 bug 2: scalar from+to join called many-to-many, on a non-list field', () => {
	const { findings } = lintMarkdown(DOCS_582_SCHEMA);
	assert.deepEqual(
		findings.map((f) => `${f.line}:${f.rule}`),
		['10:relationship-field-type', '10:relationship-cardinality'],
	);
	assert.match(findings[1].message, /says many-to-many .*Product\.sku is not a list/);
});

test('the documentation#602 fix passes', () => {
	assert.deepEqual(lintMarkdown(DOCS_602_SCHEMA).findings, []);
});

test('skills#70: the regenerated from+to prose is flagged inside a list item', () => {
	assert.deepEqual(rulesOf(SKILLS_70_ITEM_3), [
		'8:relationship-field-type',
		'8:relationship-cardinality',
	]);
});

test('skills#44: @relation is reported, and its from attribute is still checked', () => {
	assert.deepEqual(rulesOf(SKILLS_44_QUERYING), [
		'8:relationship-directive',
		'8:relationship-attribute',
	]);
});

test('current from-only and to-only examples pass, resolving to: across fences', () => {
	const { findings, checked } = lintMarkdown(CURRENT_FROM_AND_TO);
	assert.deepEqual(findings, []);
	assert.equal(checked, 3);
});

test('an inline comment naming the wrong direction is flagged', () => {
	const markdown = CURRENT_FROM_AND_TO.replace(
		'@relationship(from: networkId) # many-to-one',
		'@relationship(from: networkId) # one-to-many',
	);
	assert.deepEqual(rulesOf(markdown), ['7:relationship-cardinality']);
});

test('to: target defined only in another fence: absence is unknown, not an error', () => {
	const markdown = md(
		'```graphql',
		'type Customer @table {',
		'\tid: ID @primaryKey',
		'\torders: [Order] @relationship(to: customerId)',
		'}',
		'```',
		'',
		'An unrelated, minimal example:',
		'',
		'```graphql',
		'type Order @table {',
		'\tid: ID @primaryKey',
		'}',
		'```',
	);
	assert.deepEqual(lintMarkdown(markdown).findings, []);
});

test('to: target defined in the same fence without the attribute is flagged', () => {
	const markdown = md(
		'```graphql',
		'type Customer @table {',
		'\tid: ID @primaryKey',
		'\torders: [Order] @relationship(to: customerId)',
		'}',
		'type Order @table {',
		'\tid: ID @primaryKey',
		'\tcustomer: ID',
		'}',
		'```',
	);
	assert.deepEqual(rulesOf(markdown), ['4:relationship-attribute']);
});

test('an elided type body makes absence unknown', () => {
	for (const elision of ['\t# ... other fields', '\t...', '\t# …']) {
		const markdown = md(
			'```graphql',
			'type Book @table {',
			elision,
			'\tauthor: Author @relationship(from: authorId)',
			'}',
			'```',
		);
		assert.deepEqual(lintMarkdown(markdown).findings, [], elision);
	}
});

test('negated cardinality prose is not a claim', () => {
	const markdown = DOCS_582_SCHEMA.replace(
		'This is useful for many-to-many relationships',
		'This is not a many-to-many relationship; it joins',
	).replace('product: Product', 'products: [Product]');
	assert.deepEqual(lintMarkdown(markdown).findings, []);
});

test('prose is not checked when the fence mixes cardinalities', () => {
	const markdown = md(
		'This example shows a many-to-many relationship:',
		'',
		'```graphql',
		'type Product @table {',
		'\tid: ID @primaryKey',
		'\tbrandId: ID',
		'\tbrand: Brand @relationship(from: brandId)',
		'\tresellerIds: [ID]',
		'\tresellers: [Reseller] @relationship(from: resellerIds)',
		'}',
		'```',
	);
	assert.deepEqual(lintMarkdown(markdown).findings, []);
});

test('prose is not checked when any relationship in the fence is unresolvable', () => {
	const markdown = md(
		'A one-to-many relationship:',
		'',
		'```graphql',
		'type Network @table {',
		'\tid: ID @primaryKey',
		'\tshows: [Show] @relationship(to: networkId)',
		'\tresellerIds: [ID]',
		'\tresellers: [Reseller] @relationship(from: resellerIds)',
		'}',
		'```',
	);
	assert.deepEqual(lintMarkdown(markdown).findings, []);
});

test('the ignore marker exempts a deliberate counter-example', () => {
	const markdown = DOCS_582_QUERYING.replace('```graphql', `${IGNORE_MARKER}\n\`\`\`graphql`);
	assert.deepEqual(lintMarkdown(markdown).findings, []);
});

test('from: list attribute on a single-valued field is flagged', () => {
	const markdown = md(
		'```graphql',
		'type RealityShow @table {',
		'\tid: ID @primaryKey',
		'\tnetworkIds: [ID]',
		'\tnetwork: Network @relationship(from: networkIds)',
		'}',
		'```',
	);
	assert.deepEqual(rulesOf(markdown), ['5:relationship-field-type']);
});

test('syntax variants: multiline directive, quoted and bare args, non-null lists, CRLF', () => {
	const markdown = md(
		'A many-to-many relationship:',
		'',
		'```graphql',
		'type Product @table(database: "shop") @export {',
		'\t"""The product id"""',
		'\tid: ID! @primaryKey',
		'\tresellerIds: [ID!]! @indexed',
		'\tresellers: [Reseller!]! @relationship(',
		'\t\tfrom: "resellerIds"',
		'\t)',
		'\tcategory(locale: String): Category @relationship(from: categoryId)',
		'}',
		'```',
	).replace(/\n/g, '\r\n');
	assert.deepEqual(rulesOf(markdown), ['11:relationship-attribute']);
});

test('non-schema and malformed fences are skipped without throwing', () => {
	const markdown = md(
		'```ts',
		'type Product = { brand: Brand };',
		'```',
		'',
		'```graphql',
		'type Broken @table {',
		'\tid ID @primaryKey',
		'\tbrand: Brand @relationship(from: nope)',
		'}',
		'```',
		'',
		'```graphql',
		'type Unclosed @table {',
		'\tbrand: Brand @relationship(from: brandId',
	);
	assert.deepEqual(lintMarkdown(markdown), { findings: [], checked: 0 });
});
