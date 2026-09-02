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
  sourceCommit: 677ad213d67822e109c83619e181ca23a59823db
  inputHash: 084363f039abfe73
---

# Checking Authentication

Instructions for the agent to handle user authentication, sessions, and JWT token issuance in Harper Resources.

## When to Use

Apply this rule when implementing login/logout flows, protecting Resource endpoints by checking the current user, issuing or refreshing JWT tokens, or configuring token expiry in Harper. Use it whenever a custom Resource needs to authenticate callers or mint credentials for downstream consumers. See [custom-resources.md](custom-resources.md) for the broader Resource authoring context.

## How It Works

1. **Check the current authenticated user**: Call `getCurrentUser()` inside any Resource method. It returns the user object (with `username`, `role`, and `role.permission`) or `undefined` if unauthenticated. Guard endpoints by returning a 401 when no user is present.

   ```javascript
   async get(target) {
     const user = this.getCurrentUser();
     if (!user) return new Response(null, { status: 401 });
     return { username: user.username, role: user.role };
   }
   ```

2. **Enable sessions before using login/logout**: Set `authentication.enableSessions: true` in `harperdb-config.yaml`. Without this, `context.login` and `context.session` are unavailable.

3. **Implement login via `getContext()`**: Call `this.getContext()` to obtain the request context, then call `context.login(username, password)` to verify credentials and establish a session cookie.

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

4. **Implement logout**: Delete the session via `context.session.delete(context.session.id)`.

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

   Cookie-based sessions are intended for browser clients. For non-browser clients, use JWT issuance (steps below).

5. **Create authentication tokens**: Call `create_authentication_tokens` with credentials. No `Authorization` header is required for this operation.

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

6. **Use the operation token**: Pass it as a `Bearer` token in the `Authorization` header on subsequent requests.

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

7. **Refresh an expired operation token**: When the `operation_token` expires, use `refresh_operation_token` and pass the `refresh_token` as `Bearer <refresh_token>`.

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

8. **Mint scoped tokens for limited access**: A super user can embed an inline role in `create_authentication_tokens` using the same `permission` structure as `add_role`. Include `expires_in` to control lifetime. Do not include a `password` field. The `username` is attribution only and must not match an existing user.

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

   Key constraints for scoped tokens:
   - No refresh token is issued; no user record is created.
   - Scoped tokens cannot be revoked before expiry — choose short `expires_in` values.
   - `super_user` and `cluster_user` are always forced to `false` in the embedded role.
   - In mixed-version clusters, only nodes with scoped-token support accept these tokens; older nodes return 401.

9. **Issue tokens from a custom Resource using `server.operation`**: Import `server` from `harper` and call `server.operation()` to mint tokens programmatically. Pass `true` as the **third argument** to run the operation as the current authenticated user; omit it when supplying credentials directly.

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

10. **Configure token expiry**: Set timeouts in `harper-config.yaml` under the `authentication` section. Values follow the `jsonwebtoken` duration string format (e.g., `1d`, `12h`, `60m`).

    ```yaml
    authentication:
      operationTokenTimeout: 1d # Default: 1 day
      refreshTokenTimeout: 30d # Default: 30 days
    ```

## Examples

### Full JWT flow via cURL

```bash
# Step 1: Create tokens
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --data-raw '{
      "operation": "create_authentication_tokens",
      "username": "username",
      "password": "password"
  }'

# Step 2: Use operation token
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

# Step 3: Refresh when operation token expires
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer <refresh_token>' \
  --data-raw '{
    "operation": "refresh_operation_token"
  }'
```

### Session-based login/logout Resource

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

## Notes

- JWT authentication is **preferred over Basic Auth** when you want to avoid sending credentials on every request, when the client can store tokens, or when making multiple sequential requests. For simple or server-to-server scenarios, use Basic Authentication.
- Always use **HTTPS** in production to protect tokens in transit.
- Treat tokens like passwords. If a token is compromised, it remains valid until expiry — use shorter `operationTokenTimeout` values in high-security environments.
- `enableSessions` must be `true` in config before `context.login` or `context.session` will work.
- The `third argument` (`true`) to `server.operation` controls whether the operation runs as the current authenticated user. Omit it when the operation body supplies its own credentials.
- Scoped tokens have a 12KB limit when encoded into an `Authorization` header.
