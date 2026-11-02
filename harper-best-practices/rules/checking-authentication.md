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
  sourceCommit: 179def6d5df976cf0a6b2bec24908ecfde993c22
  inputHash: a433253fef2008d9
---

# Checking Authentication

Instructions for the agent to handle user authentication, sessions, and JWT token issuance in Harper Resources.

**Instead of:** Hand-rolled sessions, `passport`, `jsonwebtoken`, `bcrypt`. Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when implementing sign-in/sign-out flows, reading the current authenticated user, issuing or refreshing JWT tokens, or minting scoped tokens from a custom Resource. Use it whenever a Resource needs to inspect or enforce authentication state. See [custom-resources.md](custom-resources.md) for the broader Resource authoring context.

## How It Works

### Reading the Current User

1. **Use `getCurrentUser()` in instance methods** to get the user associated with the current request. Returns `undefined` if no user is authenticated.

2. **Use `context.user` in static verbs** — static verbs are not instances, so read the user from the context argument instead:

   ```javascript
   static async get(_target, context) {
     const user = context?.user;
     if (!user) return new Response(null, { status: 401 });
     return { username: user.username, role: user.role };
   }
   ```

   The returned user object exposes `username`, `role`, and `role.permission` flags.

3. **Use `getContext()` in static methods that must work on both HTTP and direct server-side calls.** Static verbs receive context as the trailing argument — `(target, context)` for `get`/`delete`, `(target, data, context)` for `put`/`patch`/`post`. Import `getContext()` from the `harper` module when a static method must handle both paths.

   When triggered by HTTP, the context also exposes `url`, `method`, `headers`, `responseHeaders`, `pathname`, `host`, `ip`, `body`, `data`, `lastModified`, and `requestContext`.

   | Property          | Description                                                                          |
   | ----------------- | ------------------------------------------------------------------------------------ |
   | `user`            | User object with username, role, and authorization info                              |
   | `transaction`     | Current transaction                                                                  |
   | `url`             | Full local path including query string                                               |
   | `method`          | HTTP method                                                                          |
   | `headers`         | Request headers (`context.headers.get(name)`)                                        |
   | `responseHeaders` | Response headers (`context.responseHeaders.set(name, value)`)                        |
   | `pathname`        | Path without query string                                                            |
   | `host`            | Host from the `Host` header                                                          |
   | `ip`              | Client IP address                                                                    |
   | `body`            | Raw Node.js `Readable` stream                                                        |
   | `data`            | Promise resolving to the deserialized request body                                   |
   | `lastModified`    | Controls `ETag`/`Last-Modified` response header                                      |
   | `requestContext`  | (For source resources only) Context of the upstream resource making the data request |

### Session Login and Logout

4. **Enable sessions** by setting `authentication.enableSessions: true` in `harperdb-config.yaml`.

5. **Use `context.login`** to verify credentials and establish a session cookie. Use `context.session.update({ user: null })` to end a session. Test `context?.session?.user` to detect an established session — `context.session` is an empty object (not `undefined`) when sessions are enabled and no session cookie is present:

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

   Cookie-based sessions are intended for browser clients. For non-browser clients, use JWT issuance.

### JWT Token Issuance

6. **Call `create_authentication_tokens`** with `username` and `password` in the body. No `Authorization` header is required when credentials are in the body:

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

7. **Pass `operation_token` as a `Bearer` token** in the `Authorization` header on subsequent requests.

8. **Refresh an expired `operation_token`** using `refresh_operation_token`. Pass the `refresh_token` as the `Bearer` token:

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

### Scoped Tokens

9. **Mint a scoped token** as a `super_user` by passing a `role` inline object to `create_authentication_tokens`. The `role` uses the same `permission` structure as `add_role`. Do not include `password` in the body — the minter must be authenticated separately. Use `expires_in` to set token lifetime:

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
   - `username` is attribution only and must not name an existing user.
   - No refresh token is issued; no user record is created.
   - Scoped tokens cannot be revoked before expiry — prefer short `expires_in` values.
   - `super_user` and `cluster_user` are always forced to `false` in the embedded role.
   - In **mixed-version** clusters, only nodes with scoped-token support accept these tokens; older nodes reject them with a 401.

### Issuing Tokens from a Custom Resource

10. **Use `server.operation()`** to mint tokens programmatically from a Resource. Pass `authorize: true` as the **third argument** when the operation should run as the current authenticated user. Omit it (or pass `false`) when the operation supplies its own credentials:

    ```javascript
    import { Resource, server } from 'harper';

    export class IssueTokens extends Resource {
    	static async get(_target, context) {
    		// current authenticated user — pass context and authorize: true
    		const { operation_token, refresh_token } = await server.operation(
    			{ operation: 'create_authentication_tokens' },
    			context,
    			true,
    		);
    		return { operation_token, refresh_token };
    	}

    	static async post(_target, data) {
    		// credentials supplied in body
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

### Token Expiry Configuration

11. **Configure token timeouts** in `harper-config.yaml` under the `authentication` section:

    ```yaml
    authentication:
      operationTokenTimeout: 1d # Default: 1 day
      refreshTokenTimeout: 30d # Default: 30 days
    ```

    Duration strings follow the `jsonwebtoken` package format (e.g., `1d`, `12h`, `60m`).

## Examples

**Mint tokens via cURL with Basic Authentication:**

```bash
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --data-raw '{
      "operation": "create_authentication_tokens",
      "username": "username",
      "password": "password"
  }'
```

**Mint a scoped token as a super_user:**

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

**Use an operation token on a subsequent request:**

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

## Notes

- JWT authentication is **preferred over Basic Auth** when you want to avoid sending credentials on every request, your client can store and manage tokens, or you have multiple sequential requests. For simple or **server-to-server** scenarios, see Basic Authentication.
- Always use **HTTPS** in production to protect tokens in transit.
- Treat tokens like passwords. If a token is compromised, it remains valid until expiry — use shorter `operationTokenTimeout` values in high-security environments.
- A caller authenticated by a Bearer validator cannot use the passwordless form of `create_authentication_tokens` and cannot mint scoped tokens; it must supply `username` and `password`.
- `context.session` is an empty object (not `undefined`) when `enableSessions` is active and no session cookie is present — always test `context?.session?.user`.
