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
  sourceCommit: 9628b6ae7649c6f6ba4d65465e83cf75d7a9b2bd
  inputHash: e8b7023b3a3ba2b5
---

# Checking Authentication

Instructions for the agent to handle user authentication, sessions, and JWT token issuance in Harper Resources.

**Instead of:** Hand-rolled sessions, `passport`, `jsonwebtoken`, `bcrypt`. Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when implementing sign-in/sign-out flows, reading the current authenticated user, issuing or refreshing JWT tokens, or minting scoped tokens from a custom Resource. Use it whenever a Resource must inspect, establish, or delegate authentication state. See [custom-resources.md](custom-resources.md) for the broader Resource authoring context.

## How It Works

### Reading the Current User

1. **Use `getCurrentUser()` in instance methods**: Call `getCurrentUser()` on a Resource instance to get the current authenticated user, or `undefined` if no user is authenticated. The returned object exposes `username`, `role`, and `role.permission` flags.

2. **Use `context.user` in static verbs**: Static verbs receive the context as a trailing argument. Read the current authenticated user from `context?.user`:

   ```javascript
   static async get(_target, context) {
     const user = context?.user;
     if (!user) return new Response(null, { status: 401 });
     return { username: user.username, role: user.role };
   }
   ```

3. **Use `getContext()` for dual-path static methods**: `getContext()` is a Resource instance method. For static methods that must work both via HTTP and direct server-side calls, import `getContext()` from the `harper` module. Static verbs receive context as the trailing argument — `(target, context)` for `get`/`delete`, `(target, data, context)` for `put`/`patch`/`post`.

4. **Access HTTP-specific context properties**: When triggered by HTTP, the context is the `Request` object with additional properties. Use these to read request metadata or set response headers:

   | Property          | Description                                                                      |
   | ----------------- | -------------------------------------------------------------------------------- |
   | `url`             | Full local path including query string                                           |
   | `method`          | HTTP method                                                                      |
   | `headers`         | Request headers (`context.headers.get(name)`)                                    |
   | `responseHeaders` | Response headers (`context.responseHeaders.set(name, value)`)                    |
   | `pathname`        | Path without query string                                                        |
   | `host`            | Host from the `Host` header                                                      |
   | `ip`              | Client IP address                                                                |
   | `body`            | Raw Node.js `Readable` stream (if a request body exists)                         |
   | `data`            | Promise resolving to the deserialized request body                               |
   | `lastModified`    | Controls `ETag`/`Last-Modified` response header                                  |
   | `requestContext`  | (Source resources only) Context of the upstream resource making the data request |
   | `transaction`     | Current transaction                                                              |

   When triggered by HTTP, the context also exposes `url`, `method`, `headers`, `responseHeaders`, `pathname`, `host`, `ip`, `body`, `data`, `lastModified`, and `requestContext`.

### Session-Based Login and Logout

5. **Enable sessions in config**: Set `authentication.enableSessions: true` in `harperdb-config.yaml` before using `context.login` or `context.session`.

6. **Implement sign-in with `context.login`**: Call `context.login(username, password)` in a static `post` verb. It verifies credentials and establishes the session cookie on success:

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
   ```

7. **Implement sign-out by clearing the session user**: Use `context.session.update({ user: null })` — `update` is the session's only mutator. Test `context?.session?.user` to detect an established session, because `context.session` is an empty object (not `undefined`) when sessions are enabled and no session cookie is present:

   ```javascript
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

8. **Call `create_authentication_tokens` with credentials**: Send `username` and `password` in the request body. No `Authorization` header is required when credentials are in the body:

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

9. **Pass the `operation_token` as a Bearer token** on subsequent requests:

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

10. **Refresh an expired `operation_token`** using `refresh_operation_token`. Pass the `refresh_token` as `Bearer <refresh_token>`:

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

### Scoped Tokens (Inline Role)

11. **Mint a scoped token as a `super_user`**: Pass `role` as an inline role-shaped object using the same `permission` structure as `add_role`. The minter must be authenticated as a `super_user`; no `password` may be included in the body. Use `expires_in` to set the token lifetime:

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

    Key constraints:
    - `username` is attribution only and must not name an existing user.
    - No refresh token is issued; no user record is created.
    - Scoped tokens cannot be revoked before expiry — prefer short lifetimes.
    - `super_user` and `cluster_user` are always forced to `false` in the embedded role.
    - In **mixed-version** clusters, only nodes with scoped-token support accept these tokens; older nodes reject them with a 401.

### Issuing Tokens from a Custom Resource

12. **Use `server.operation()` to mint tokens programmatically**: Import `server` from `harper` and call `server.operation(operation, context, authorize)`. Pass `authorize: true` as the **third argument** when the operation should run as the current authenticated user; omit it or pass `false` when the operation supplies its own credentials:

    ```javascript
    import { Resource, server } from 'harper';

    export class IssueTokens extends Resource {
    	static async get(_target, context) {
    		// Caller is already authenticated — issue tokens for the current authenticated user.
    		const { operation_token, refresh_token } = await server.operation(
    			{ operation: 'create_authentication_tokens' },
    			context,
    			true,
    		);
    		return { operation_token, refresh_token };
    	}

    	static async post(_target, data) {
    		// Caller provides credentials in the body.
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

13. **Configure token timeouts** in `harper-config.yaml` under the `authentication` section:

    ```yaml
    authentication:
      operationTokenTimeout: 1d # Default: 1 day
      refreshTokenTimeout: 30d # Default: 30 days
    ```

    Valid duration strings follow the `jsonwebtoken` package format (e.g., `1d`, `12h`, `60m`).

## Examples

### Full sign-in/sign-out Resource pair

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

### Minting tokens via the Operations API

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

- **JWT is preferred over Basic Auth** for clients that can store tokens, want to avoid sending credentials on every request, or make multiple sequential requests. For simple or **server-to-server** scenarios, use Basic Authentication.
- Always use **HTTPS** in production to protect tokens in transit.
- Treat tokens like passwords. Because scoped tokens cannot be revoked before expiry, set short `expires_in` values in high-security environments and consider lowering `operationTokenTimeout`.
- A caller authenticated by a Bearer validator cannot mint tokens via the passwordless form — it must supply `username` and `password`.
- `enableSessions` is required in `harperdb-config.yaml` for `context.login` and `context.session` to be available.
- The **third argument** (`authorize: true`) to `server.operation()` attributes the operation to — and permission-checks against — the calling user.
