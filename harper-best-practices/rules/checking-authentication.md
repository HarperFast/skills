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
    - reference/v5/security/jwt-authentication.md#Security Notes
  sourceCommit: 677ad213d67822e109c83619e181ca23a59823db
  inputHash: 4415f129190f92e0
---

# Checking Authentication

Instructions for the agent to follow when handling user authentication, sessions, and JWT token issuance in Harper Resources.

## When to Use

Apply this rule when implementing sign-in/sign-out flows, inspecting the current user, issuing or refreshing JWT tokens, or minting scoped tokens from a custom Resource. Use it whenever a Harper endpoint must gate access based on identity or produce credentials for downstream consumers. See [custom-resources.md](custom-resources.md) for the broader Resource authoring model.

## How It Works

### 1. Inspect the Current User

1. **Call `getCurrentUser()`** inside any Resource method to retrieve the authenticated user for the request, or `undefined` if unauthenticated.

   ```javascript
   async get(target) {
     const user = this.getCurrentUser();
     if (!user) return new Response(null, { status: 401 });
     return { username: user.username, role: user.role };
   }
   ```

   The returned object exposes `username`, `role`, and `role.permission` flags.

### 2. Handle Sessions via `getContext()`

2. **Enable sessions** in `harperdb-config.yaml` before using session-based login:

   ```yaml
   authentication:
     enableSessions: true
   ```

3. **Call `context.login`** to verify credentials and establish a session cookie:

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

4. **Delete the session** to sign out:

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

   Cookie-based sessions are intended for browser clients. For non-browser clients, use JWT issuance (see steps below).

### 3. Issue JWT Tokens via the Operations API

5. **Call `create_authentication_tokens`** with credentials. No `Authorization` header is needed for this operation:

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

6. **Pass the `operation_token`** as a `Bearer` token on subsequent requests:

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

### 4. Refresh an Expired Operation Token

7. **Call `refresh_operation_token`** using the `refresh_token` as the `Bearer` token when the `operation_token` expires:

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

### 5. Mint Scoped Tokens

8. **Issue a scoped token** as a super user by passing an inline `role` object to `create_authentication_tokens`. Do not include `password`. Use `add_role`-style `permission` structure. Set `expires_in` to control lifetime:

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

   Response:

   ```json
   {
   	"operation_token": "<jwt-scoped-token>"
   }
   ```

   Key constraints for scoped tokens:
   - `username` is attribution only and must not match an existing `hdb_user`.
   - `super_user` and `cluster_user` are always forced to `false` in the embedded role.
   - No refresh token is issued; no user record is created.
   - Scoped tokens cannot be revoked before expiry — choose short `expires_in` values in high-security environments.
   - The permission object is validated at mint time; the resulting token must fit within a 12 KB `Authorization` header.

### 6. Issue Tokens from a Custom Resource via `server.operation`

9. **Import `server`** and call `server.operation` to mint or refresh tokens programmatically from a Resource:

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

   Pass `true` as the third argument to `server.operation` when the operation should run as the current authenticated user. Omit it (or pass `false`) when the operation supplies its own credentials.

### 7. Configure Token Expiry

10. **Set token timeouts** in `harper-config.yaml` under the `authentication` section:

    ```yaml
    authentication:
      operationTokenTimeout: 1d # Default: 1 day
      refreshTokenTimeout: 30d # Default: 30 days
    ```

    Duration strings follow the `jsonwebtoken` package format (e.g., `1d`, `12h`, `60m`).

## Examples

**Full sign-in/sign-out Resource pair with session:**

```javascript
import { Resource } from 'harper';

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

**Mint tokens via cURL:**

```bash
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "operation": "create_authentication_tokens",
    "username": "username",
    "password": "password"
  }'
```

**Refresh an operation token via cURL:**

```bash
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer <refresh_token>' \
  --data-raw '{
    "operation": "refresh_operation_token"
  }'
```

## Notes

- Always use HTTPS in production to protect tokens in transit. Tokens must be treated like passwords.
- If a token is compromised, it remains valid until expiry. Use shorter `operationTokenTimeout` values in high-security environments.
- `enableSessions` must be `true` in `harperdb-config.yaml` for `context.login` and `context.session` to function.
- Scoped tokens are not tied to a user row; rotating the instance's JWT keys is the only way to invalidate them before `expires_in` elapses.
- In mixed-version clusters, only nodes with scoped-token support accept scoped tokens; older nodes return 401.
