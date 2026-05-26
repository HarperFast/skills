---
name: logging
description: Best practices for logging in Harper, including console capture, the granular logger interface, and programmatic log retrieval.
metadata:
  mode: synthesized
---

# Logging Best Practices

Harper provides a robust logging system that captures standard output and offers a granular, tagged logging interface for both local and deployed environments.

## Standard Console Logging

The simplest way to log in Harper is using standard JavaScript console methods. `console.log()`, `console.warn()`, `console.error()`, and `console.trace()` are automatically captured by Harper and can be viewed in the logs.

- `console.log(...)`: Captured as `stdout` level in Harper logs.
- `console.warn(...)`: Captured as `stderr` level in Harper logs.
- `console.error(...)`: Captured as `stderr` level in Harper logs.
- `console.trace(...)`: Captured as `stdout` level in Harper logs (includes stack trace).

## Harper Logger

For more granularity and better organization, use Harper's built-in `logger`. You can use the global `logger` object or import it from the `harper` package.

### Log Levels

The Harper `logger` supports the following levels (ordered by increasing severity):

- `trace`
- `debug`
- `info`
- `warn`
- `error`
- `fatal`
- `notify`

### Usage

```typescript
import { logger, loggerWithTag } from 'harper';

// Basic logging
logger.info('Application started');
logger.error('An error occurred', error);

// Tagged logging for better filtering (Namespacing)
const authLogger = loggerWithTag('auth');
authLogger.debug('User login attempt', { userId: '123' });
```

Using `loggerWithTag` is highly recommended for grouping related logs, making them much easier to filter and analyze in the Harper Studio or via the API.

## Programmatic Log Retrieval

You can programmatically read logs from a deployed Harper instance using the `read_log` operation. This is useful for building custom monitoring tools or debugging dashboards.

### `read_log` Operation

The `read_log` operation is a POST request to the Harper instance.

**Example Request:**

```json
{
	"operation": "read_log",
	"limit": 100,
	"start": 0,
	"level": "error",
	"order": "desc",
	"from": "2024-01-01T00:00:00.000Z",
	"until": "2024-01-02T00:00:00.000Z"
}
```

### Parameters

- `limit`: Number of log entries to return.
- `start`: Offset for pagination.
- `level`: Filter by log level (`info`, `error`, `warn`, `debug`, `trace`, `notify`, `fatal`, `stdout`, `stderr`).
- `from`: ISO 8601 timestamp to start reading from.
- `until`: ISO 8601 timestamp to stop reading at.
- `order`: Sort order, either `asc` or `desc`.
- `replicated`: (Boolean) Include logs from replicated nodes in a cluster.

### Log Entry Structure

Each log entry returned by `read_log` typically includes:

- `level`: The severity level of the log.
- `timestamp`: When the log was recorded.
- `thread`: The execution thread.
- `tags`: An array of tags (e.g., from `loggerWithTag`).
- `node`: The node name in a Harper cluster.
- `message`: The logged content.
