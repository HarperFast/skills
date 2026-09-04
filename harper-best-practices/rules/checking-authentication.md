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
    - reference/v5/security/jwt-authentication.md#Scoped Tokens (Inline Role)
    - >-
      reference/v5/security/jwt-authentication.md#Issuing Tokens from a Custom
      Resource
    - reference/v5/security/jwt-authentication.md#Token Expiry Configuration
    - reference/v5/security/jwt-authentication.md#When to Use JWT Auth
    - reference/v5/security/jwt-authentication.md#Security Notes
  sourceCommit: 0d151a2c1f8d3988aef4dc6fc7deaa3e13f13589
  inputHash: a68a7161d2f4bf61
---

# Checking Authentication

Instructions for the agent to follow when handling user authentication, sessions, and JWT token issuance in Harper Resources.

## When to Use

Apply this rule when implementing login/logout flows, protecting Resource endpoints by inspecting the current user, or issuing and refreshing JWT tokens from a custom Resource or the Operations API. Use it whenever a task involves `getCurrentUser()`, session management, or token lifecycle in Harper. See [custom-resources.md](custom-resources.md) for the broader Resource authoring context.

## How It Works

1. **Inspect the current authenticated user**: Call `getCurrentUser()` inside any Resource method to retrieve the user associated with the request. Returns `undefined` if unauthenticated. Use the returned object's `username`, `role`, and `role.permission` flags.

   ```javascript
   async get(target) {
     const user = this.getCurrentUser();
     if (!user) return new Response(null, { status: 401 });
     return { username: user.username, role: user.role };
   }
   ```

2. **Enable sessions before using login/logout**: Set `authentication.enableSessions: true` in `harper-config.yaml`. Without this, `context.login` and `context.session` are unavailable.

   ```yaml
   authentication:
     enableSessions: true
   ```

3. **Handle login via `context.login`**: Call `getContext()` to obtain the context object, then call `context.login(username, password)`. On success it verifies credentials and establishes the session cookie. On failure it throws — catch and return a `403`.

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
   ```

4. **Handle logout via `context.session`**: Delete the session using its ID. Return `401` if no session exists.

   ```javascript
   export class SignOut extends Resource {
   	async post() {
   		const context = this.getContext();
   		if (!context.session) return new Response(null, { status: 401 });
   		await context.session.delete(context.session.id);
   		return new Response('Logged out', { status: 200 });
   	}
   }
   ```

   Cookie-based sessions are intended for browser clients. For non-browser clients, use JWT issuance instead.

5. **Issue JWT tokens via `create_authentication_tokens`**: POST the operation with `username` and `password` in the body — no `Authorization` header is required in this shape. The response contains an `operation_token` and a `refresh_token`.

   ```json
   {
   	"operation": "create_authentication_tokens",
   	"username": "username",
   	"password": "password"
   }
   ```

6. **Use the operation token on subsequent requests**: Pass the `operation_token` as a `Bearer` token in the `Authorization` header.

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

7. **Refresh an expired operation token**: When the `operation_token` expires, use `refresh_operation_token` and pass the `refresh_token` as `Bearer <refresh_token>` in the `Authorization` header.

   ```bash
   curl --location --request POST 'http://localhost:9925' \
     --header 'Content-Type: application/json' \
     --header 'Authorization: Bearer <refresh_token>' \
     --data-raw '{
       "operation": "refresh_operation_token"
     }'
   ```

   When both tokens have expired, call `create_authentication_tokens` again with username and password.

8. **Mint scoped tokens with an inline role**: A `super_user` can embed permissions directly in a token using the `role` field and `expires_in`. The `username` is attribution only and must not name an existing user. No `refresh_token` is issued. Use `add_role`-style `permission` structure.

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

   Authenticate the mint request as a `super_user` via Basic Authentication or an existing `super_user` `operation_token`. Without an authenticated `super_user`, the mint is rejected with `403 Only super_user can create a token with an inline role`.

9. **Issue tokens from a custom Resource using `server.operation`**: Import `server` from `harper` and call `server.operation()`. Pass `authorize: true` as the **third argument** when the operation should run as the current authenticated user; omit it when the operation supplies its own credentials.

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
   ```

10. **Configure token expiry**: Set `operationTokenTimeout` and `refreshTokenTimeout` under `authentication` in `harper-config.yaml`. Values follow the `jsonwebtoken` duration string format (e.g., `1d`, `12h`, `60m`).

    ```yaml
    authentication:
      operationTokenTimeout: 1d
      refreshTokenTimeout: 30d
    ```

## Examples

### Full token refresh Resource

```javascript
import { Resource, server } from 'harper';

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

### Minting a scoped token via cURL (Basic Authentication)

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

Response:

```json
{
	"operation_token": "<jwt-scoped-token>"
}
```

## Notes

- JWT authentication is **preferred over Basic Auth** when you want to avoid sending credentials on every request, your client can store tokens, or you have multiple sequential requests. For simple or **server-to-server** scenarios, Basic Authentication remains an option.
- Always use **HTTPS** in production to protect tokens in transit.
- Scoped tokens cannot be revoked before they expire — they are not tied to a user row. Choose `expires_in` carefully; prefer short lifetimes in high-security environments. Setting a shorter `operationTokenTimeout` also limits exposure if an operation token is compromised.
- In **mixed-version** clusters, only nodes with scoped-token support accept scoped tokens; older nodes reject them with a `401`.
- `super_user` and `cluster_user` are always forced to `false` in an embedded scoped role — they cannot be elevated via inline role minting.
- The `server.operation()` third argument (`authorize: true`) attributes the operation to the calling user and enforces their permissions. Omit it when the operation body carries its own credentials.
- Cookie-based sessions (`context.login`) are for browser clients only. Use JWT issuance for CLI tools, mobile apps, and service-to-service communication.
