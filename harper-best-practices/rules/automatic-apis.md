---
name: automatic-apis
description: How to use Harper's automatically generated REST and WebSocket APIs.
---

# Automatic APIs

Instructions for the agent to follow when utilizing Harper's automatic APIs.

## When to Use

Use this skill when you want to interact with Harper tables via REST or WebSockets without writing custom resource logic. This is ideal for basic CRUD operations and real-time updates.

## How It Works

1. **Enable Automatic APIs**: Ensure your GraphQL schema includes the `@export` directive for the table.
2. **Access REST Endpoints**: Use the standard endpoints for your table (Note: Paths are case-sensitive).
3. **Use Automatic WebSockets**: Connect to `wss://your-harper-instance/{TableName}` to receive events whenever updates are made to that table. This is the easiest way to add real-time capabilities. (Use `ws://` for local development without SSL). For more complex needs, see [Real-time Apps](real-time-apps.md).
4. **Apply Filtering and Querying**: Use query parameters with `GET /{TableName}/` and `DELETE /{TableName}/`. See the [Querying REST APIs](querying-rest-apis.md) skill for advanced details.
5. **Customize if Needed**: If the automatic APIs don't meet your requirements, [customize the resources](./custom-resources.md).

## Examples

### Schema Configuration

```graphql
type MyTable @table @export {
	id: ID @primaryKey
	name: String
}
```

### Common REST Operations

- **List Records**: `GET /MyTable/`
- **Create Record**: `POST /MyTable/`
- **Update Record**: `PATCH /MyTable/{id}`
