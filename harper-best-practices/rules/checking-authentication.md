---
name: checking-authentication
description: How to handle user authentication and sessions in Harper Resources.
metadata:
  mode: generate
  sources:
    - >-
      reference/v5/resources/resource-api.md#`getCurrentUser(): User |
      undefined`
    - reference/v5/resources/resource-api.md#Session and Login from a Resource
    - reference/v5/security/jwt-authentication.md#Create Authentication Tokens
    - reference/v5/security/jwt-authentication.md#Using the Operation Token
    - reference/v5/security/jwt-authentication.md#Refreshing the Operation Token
    - >-
      reference/v5/security/jwt-authentication.md#Issuing Tokens from a Custom
      Resource
    - reference/v5/security/jwt-authentication.md#Token Expiry Configuration
  sourceCommit: 677ad213d67822e109c83619e181ca23a59823db
  inputHash: 6c17172abd736b10
---

# Checking Authentication

Instructions for the agent to follow when handling user authentication, sessions, and JWT token issuance in Harper Resources.

## When to Use

Apply this rule when implementing login/logout flows, protecting Resource endpoints behind authentication checks, issuing or refreshing JWT tokens, or configuring token expiry in a Harper application. Use it alongside [custom-resources.md](custom-resources.md) when building Resource-style auth endpoints.

## How It Works

1. **Check the current user**: Call `getCurrentUser()` inside any Resource method to retrieve the authenticated user or `undefined` if unauthenticated. Guard protected endpoints by returning a `401` when no user is present.

   ```javascript
   async get(target) {
     const user = this.getCurrentUser();
     if (!user) return new Response(null, { status: 401 });
     return { username: user.username, role: user.role };
   }
   ```

   The returned object exposes `username`, `role`, and `role.permission` flags.

2. **Enable sessions**: To use cookie-based sessions, set `authentication.enableSessions: true` in `harperdb-config.yaml`. This is required before `context.login` or `context.session` will work.

   ```yaml
   authentication:
     enableSessions: true
   ```

3. **Log in and out via context**: Call `getContext()` inside a Resource method to access `context.login` and `context.session`. Use `context.login(username, password)` to verify credentials and establish a session cookie. To end a session, delete it via `context.session.delete(context.session.id)`.

   ```javascript
   export class SignIn extends Resource {
   	async post(_target, data) {
   		const context = this.getContext();
   		try {
   			await context.login(data.username, data.password);
   		} catch {
   			return new Response('Invalid credentials', { status: 403 });
   		}
   		return new Response('Logged in', { status: 200 });
   	}
   }

   export class SignOut extends Resource {
   	async post() {
   		const context = this.getContext();
   		if (!context.session) return new Response(null, { status: 401 });
   		await context.session.delete(context.session.id);
   		return new Response('Logged out', { status: 200 });
   	}
   }
   ```

   Cookie-based sessions are intended for browser clients. For non-browser clients (CLI tools, mobile apps, service-to-service), use JWT issuance instead (see steps below).

4. **Issue JWT tokens via the Operations API**: Call `create_authentication_tokens` with credentials. No `Authorization` header is required for this operation.

   ```json
   {
   	"operation": "create_authentication_tokens",
   	"username": "username",
   	"password": "password"
   }
   ```

   The response returns an `operation_token` and a `refresh_token`:

   ```json
   {
   	"operation_token": "<jwt-operation-token>",
   	"refresh_token": "<jwt-refresh-token>"
   }
   ```

5. **Use the operation token**: Pass the `operation_token` as a `Bearer` token in the `Authorization` header on subsequent requests.

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

6. **Refresh an expired operation token**: When the `operation_token` expires, use `refresh_operation_token` with the `refresh_token` as the `Bearer` token to obtain a new one.

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

7. **Mint tokens from a custom Resource using `server.operation`**: Import `server` from `harper` and invoke `server.operation()` to issue or refresh tokens programmatically from a Resource endpoint. Pass `true` as the third argument (`authorize`) to run the operation as the current authenticated user; omit it or pass `false` when the operation supplies its own credentials.

   ```javascript
   import { Resource, server } from 'harper';

   export class IssueTokens extends Resource {
   	static async get(_target, context) {
   		const { operation_token, refresh_token } = await server.operation(
   			{ operation: 'create_authentication_tokens' },
   			context,
   			true,
   		);
   		return { operation_token, refresh_token };
   	}

   	static async post(_target, data) {
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

8. **Configure token expiry**: Set `operationTokenTimeout` and `refreshTokenTimeout` under the `authentication` key in `harper-config.yaml`. Values follow the `jsonwebtoken` package duration string format (e.g., `1d`, `12h`, `60m`).

   ```yaml
   authentication:
     operationTokenTimeout: 1d # Default: 1 day
     refreshTokenTimeout: 30d # Default: 30 days
   ```

## Examples

**Full JWT issuance flow via cURL:**

```bash
# Step 1: Get tokens
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "operation": "create_authentication_tokens",
    "username": "username",
    "password": "password"
  }'

# Step 2: Use the operation_token
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

# Step 3: Refresh when expired
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer <refresh_token>' \
  --data-raw '{
    "operation": "refresh_operation_token"
  }'
```

## Notes

- `getCurrentUser()` and `getContext()` are instance methods available inside Resource method bodies.
- `context.login` and `context.session` are only available when `enableSessions: true` is set in `harperdb-config.yaml`.
- Cookie-based sessions are for browser clients only. Use JWT tokens (`create_authentication_tokens`) for non-browser clients.
- `server.operation` is the programmatic equivalent of the Operations API — use it inside Resources to avoid exposing raw operation endpoints. See [custom-resources.md](custom-resources.md) for Resource authoring patterns.
- When both the `operation_token` and `refresh_token` have expired, re-authenticate with `create_authentication_tokens` using username and password.
