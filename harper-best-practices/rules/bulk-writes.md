---
name: bulk-writes
description: Best practices for performing bulk data operations in HarperDB, including Data Loader, local scripting, and programmatic table requests.
---

# Bulk Writes

Guidelines for efficiently importing or updating large volumes of data in Harper.

## When to Use

Use these methods when you need to:

- Seed a new database with initial data.
- Perform large-scale migrations from other systems.
- Periodically synchronize data from external sources.
- Handle high-volume write operations from within a Harper application.

## 1. Import CSV (Studio & Operations API)

The fastest way to import CSV data is through the Harper Studio UI or the Operations API. This creates an import job that processes records efficiently.

- **Studio UI**: Use the "Import CSV" feature in the Studio for one-off manual imports.
- **Operations API**: Use the [CSV Import](https://docs.harperdb.io/reference/v5/database/data-loader) (Operations API) for regular, programmatic ingestion.
- **Best Practice**: Use this when you have existing CSV files that need to be ingested into tables, especially for large datasets.

## 2. Data Loader

The Data Loader is a built-in component that loads data from JSON or YAML files into Harper tables as part of component deployment. It is designed for seeding tables with initial records — configuration data, reference data, default users, or other records that should exist when a component is first deployed or updated.

### Configuration

In your component's `config.yaml`, use the `dataLoader` key to specify the data files to load:

```yaml
dataLoader:
  files: 'data/*.json'
```

`dataLoader` is a [plugin](https://docs.harperdb.io/reference/v5/database/data-loader) and supports the standard `files` configuration option, including glob patterns.

### Data File Format

Each data file loads records into a single table. The file specifies the target database, table, and an array of records.

## 3. Local Scripting (Remote Seed)

For more complex logic during seeding (e.g., handling binary data, conditional updates), you can use a local script to push data via the REST API.

- **Authentication**: Use Basic Auth with your Harper credentials.
- **Batching**: While individual `PUT` or `PATCH` requests work, consider batching if the API supports it, or using concurrent requests with limiters to avoid overwhelming the network.
- **Binary Data**: For fields like images or audio, encode them as Base64 in your JSON payload.

### Example: Local Restore Script

```javascript
const headers = {
	'Content-Type': 'application/json',
	Authorization: `Basic ${Buffer.from('user:pass').toString('base64')}`,
};
const baseUrl = 'https://your.cluster.harperfabric.com';

const response1 = await putRecord(baseUrl, 'Beetles', '1', { name: 'John' });
const response2 = await putRecord(baseUrl, 'Beetles', '2', { name: 'Paul' });
const response3 = await putRecord(baseUrl, 'Beetles', '3', { name: 'George' });
const response4 = await putRecord(baseUrl, 'Beetles', '4', { name: 'Ringo' });

async function putRecord(baseUrl, table, id, data) {
	const res = await fetch(`${baseUrl}/${table}/${id}`, {
		method: 'PUT',
		headers,
		body: JSON.stringify(data),
	});
	return res.json();
}
```

## 4. Programmatic Table Requests

Inside a Harper application or Resource, you can use the `tables` object to perform bulk writes.

- **Iterative Writes**: Use `await tables.MyTable.post(record)` or `put(id, record)` in a loop.
- **Streaming**: If reading from another table to perform a bulk write, use `search()` with `for await` to handle large datasets without memory exhaustion.
- **Startup Seeding**: You can invoke seeding logic in your application's `start` function or when a specific "setup" resource is triggered.

### Example: Programmatic Seed

```javascript
export class Seeder extends Resource {
	async post(data) {
		for (const item of data) {
			await tables.MyTable.put(item.id, item);
		}
	}
}
```

## Cautions

- **Atomicity**: Bulk operations via the REST API or multiple `tables` calls are not automatically wrapped in a single transaction unless explicitly managed (if the underlying storage engine supports it).
- **Performance**: Very large bulk writes can impact the performance of concurrent reads. Monitor your cluster health during massive imports.
- **ID Management**: Ensure your source data has consistent primary keys (hash attributes) to avoid accidental duplicates or overwrites.
