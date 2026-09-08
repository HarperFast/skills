---
name: checking-authentication
description: How to handle user authentication and sessions in Harper Resources.
metadata:
  mode: generate
  sources:
    - >-
      reference/v5/resources/resource-api.md#`getCurrentUser(): User |
      undefined`
    - 'reference/v5/resources/resource-api.md#`getContext(): Context`'
    - reference/v5/resources/resource-api.md#Session and Login from a Resource
    - reference/v5/security/jwt-authentication.md#Create Authentication Tokens
    - reference/v5/security/jwt-authentication.md#Using the Operation Token
    - reference/v5/security/jwt-authentication.md#Refreshing the Operation Token
    - reference/v5/security/jwt-authentication.md#Scoped Tokens (Inline Role)
    - >-
      reference/v5/security/jwt-authentication.md#Issuing Tokens from a Custom
      Resource
    - reference/v5/security/jwt-authentication.md#Token Expiry Configuration
    - reference/v5/security/jwt-authentication.md#When to Use JWT Auth
    - reference/v5/security/jwt-authentication.md#Security Notes
  sourceCommit: 9e6ecf87dd25bb488ad44dc2876ca6439ccd682e
  inputHash: 1837f39fdfe06fac
---

# Checking Authentication

Instructions for the agent to handle user authentication, sessions, and JWT token issuance in Harper Resources.

## When to Use

Apply this rule when implementing login/logout flows, reading the current authenticated user, issuing or refreshing JWT tokens, or minting scoped tokens from a custom Resource. Use it whenever a Resource must gate behavior on identity or credentials. See [custom-resources.md](custom-resources.md) for the broader Resource authoring model.

## How It Works

### 1. Reading the Current Authenticated User

**In an instance method**, call `getCurrentUser()` to get the user associated with the current request, or `undefined` if unauthenticated. The returned object exposes `username`, `role`, and `role.permission` flags.

**In a static verb**, read the user from the `context` argument instead — `context.user`:

```javascript
static async get(_target, context) {
    const user = context?.user;
    if (!user) return new Response(null, { status: 401 });
    return { username: user.username, role: user.role };
}
```

### 2. Reading the Full Context

**In an instance method**, call `getContext()` to retrieve the current context, which includes:

- `user` — User object with username, role, and authorization information
- `transaction` — The current transaction

**In a static verb**, the context is the trailing argument:

- `(target, context)` for `get`/`delete`
- `(target, data, context)` for `put`/`patch`/`post`

When triggered by HTTP, the context also exposes `url`, `method`, `headers`, `responseHeaders`, `pathname`, `host`, `ip`, `body`, `data`, `lastModified`, and `requestContext`.

### 3. Handling Sessions and Login

Enable sessions in `harperdb-config.yaml`:

```yaml
authentication:
  enableSessions: true
```

Use `context.login` in a static `post` verb to verify credentials and establish a session cookie:

```javascript
export class SignIn extends Resource {
	static async post(_target, data, context) {
		const { username, password } = (await data) ?? {};
		try {
			await context.login(username, password);
		} catch {
			return new Response('Invalid credentials', { status: 403 });
		}
		return new Response('Logged in', { status: 200 });
	}
}

export class SignOut extends Resource {
	static async post(_target, _data, context) {
		if (!context?.session?.user) return new Response(null, { status: 401 });
		await context.session.update({ user: null });
		return new Response('Logged out', { status: 200 });
	}
}
```

- `context.login(username, password)` verifies credentials and sets the session cookie on success.
- To end a session, call `context.session.update({ user: null })` — `update` is the session's only mutator.
- `context.session` is an empty object (not `undefined`) when sessions are enabled and no session cookie is present; test `context?.session?.user` to detect an established session.
- Cookie-based sessions are for browser clients. For non-browser clients, use JWT issuance.

### 4. Creating Authentication Tokens

Call `create_authentication_tokens` with credentials in the body — no `Authorization` header is required when `username` and `password` are supplied:

```json
{
	"operation": "create_authentication_tokens",
	"username": "username",
	"password": "password"
}
```

Response:

```json
{
	"operation_token": "<jwt-operation-token>",
	"refresh_token": "<jwt-refresh-token>"
}
```

Pass the `operation_token` as a `Bearer` token on subsequent requests:

```bash
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer <operation_token>' \
  --data-raw '{
      "operation": "search_by_hash",
      "schema": "dev",
      "table": "dog",
      "hash_values": [1],
      "get_attributes": ["*"]
  }'
```

### 5. Refreshing the Operation Token

When the `operation_token` expires, pass the `refresh_token` as `Bearer <refresh_token>` and call `refresh_operation_token`:

```bash
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer <refresh_token>' \
  --data-raw '{
    "operation": "refresh_operation_token"
  }'
```

Response:

```json
{
	"operation_token": "<new-jwt-operation-token>"
}
```

When both tokens have expired, call `create_authentication_tokens` again with username and password.

### 6. Minting Scoped Tokens

A `super_user` can mint a scoped token with embedded permissions using `create_authentication_tokens` with an inline `role`. The minter must be authenticated; no `password` may be included in the body. Use `add_role`-style `permission` structure:

```json
{
	"operation": "create_authentication_tokens",
	"username": "reporting-service",
	"role": {
		"permission": {
			"operations": ["read_only"],
			"dev": {
				"tables": {
					"dog": {
						"read": true,
						"insert": false,
						"update": false,
						"delete": false,
						"attribute_permissions": []
					}
				}
			}
		}
	},
	"expires_in": "7d"
}
```

Authenticate the mint request with Basic Authentication or an existing `super_user` `operation_token`:

```bash
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Basic <base64 of super_user:password>' \
  --data-raw '{
      "operation": "create_authentication_tokens",
      "username": "reporting-service",
      "role": { "permission": { "operations": ["read_only"] } },
      "expires_in": "7d"
  }'
```

Key constraints for scoped tokens:

- `username` is attribution only and must not name an existing user.
- No refresh token is issued; no user record is created.
- Scoped tokens cannot be revoked before expiry — choose `expires_in` carefully and prefer short lifetimes.
- `super_user` and `cluster_user` are always forced to `false` in the embedded role.
- In **mixed-version** clusters, only nodes with scoped-token support accept these tokens; older nodes reject them with 401.

### 7. Issuing Tokens from a Custom Resource

Use `server.operation()` to mint tokens programmatically inside a Resource. Pass `authorize: true` as the **third argument** when the operation should run as the current authenticated user:

```javascript
import { Resource, server } from 'harper';

export class IssueTokens extends Resource {
	static async get(_target, context) {
		// Issue tokens for the current authenticated user
		const { operation_token, refresh_token } = await server.operation(
			{ operation: 'create_authentication_tokens' },
			context,
			true, // third argument: authorize as current user
		);
		return { operation_token, refresh_token };
	}

	static async post(_target, data) {
		// Issue tokens from credentials supplied in the body
		const { username, password } = await data;
		if (!username || !password) {
			return new Response('username and password required', { status: 400 });
		}
		const { operation_token, refresh_token } = await server.operation({
			operation: 'create_authentication_tokens',
			username,
			password,
		});
		return { operation_token, refresh_token };
	}
}

export class RefreshJWT extends Resource {
	static async post(_target, data) {
		const { refresh_token } = await data;
		if (!refresh_token) {
			return new Response('refresh_token required', { status: 400 });
		}
		const { operation_token } = await server.operation({
			operation: 'refresh_operation_token',
			refresh_token,
		});
		return { operation_token };
	}
}
```

Omit the third argument (or pass `false`) when the operation supplies its own credentials.

### 8. Configuring Token Expiry

Set timeouts in `harper-config.yaml` under the `authentication` section:

```yaml
authentication:
  operationTokenTimeout: 1d # Default: 1 day
  refreshTokenTimeout: 30d # Default: 30 days
```

Valid duration strings follow the `jsonwebtoken` package format (e.g., `1d`, `12h`, `60m`). The `expires_in` field on scoped token minting accepts the same format.

## Examples

### Full Sign-In / Sign-Out Resource

```javascript
export class SignIn extends Resource {
	static async post(_target, data, context) {
		const { username, password } = (await data) ?? {};
		try {
			await context.login(username, password);
		} catch {
			return new Response('Invalid credentials', { status: 403 });
		}
		return new Response('Logged in', { status: 200 });
	}
}

export class SignOut extends Resource {
	static async post(_target, _data, context) {
		if (!context?.session?.user) return new Response(null, { status: 401 });
		await context.session.update({ user: null });
		return new Response('Logged out', { status: 200 });
	}
}
```

### Reading the Current Authenticated User in a Static Verb

```javascript
static async get(_target, context) {
    const user = context?.user;
    if (!user) return new Response(null, { status: 401 });
    return { username: user.username, role: user.role };
}
```

### Minting Tokens via cURL

```bash
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --data-raw '{
      "operation": "create_authentication_tokens",
      "username": "username",
      "password": "password"
  }'
```

## Notes

- JWT authentication is **preferred over Basic Auth** when you want to avoid sending credentials on every request, your client can store tokens, or you have multiple sequential requests. For simple or **server-to-server** scenarios, use **Basic Authentication**.
- Always use **HTTPS** in production to protect tokens in transit.
- Treat tokens like passwords. If a token is compromised, it remains valid until expiry — use shorter `operationTokenTimeout` values in high-security environments.
- `context.login` and `context.session` require `enableSessions: true` in `harperdb-config.yaml`; they are for browser clients only.
- The `server.operation()` third argument (`authorize: true`) attributes the operation to — and permission-checks against — the current authenticated user. Omit it when supplying credentials directly in the operation body.
- In **mixed-version** clusters, scoped tokens are only accepted by nodes that support them; older nodes return 401.
