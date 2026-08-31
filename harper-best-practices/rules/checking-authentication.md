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
    - reference/v5/security/jwt-authentication.md
  sourceCommit: 677ad213d67822e109c83619e181ca23a59823db
  inputHash: bc60a8c93d0f829b
---

# Checking Authentication

Instructions for the agent to handle user authentication and session management within Harper Resources.

## When to Use

Apply this rule when implementing authentication checks, login/logout flows, or session handling inside a custom Resource. Use it whenever a Resource needs to identify the current user, guard endpoints behind authentication, or establish/destroy cookie-based sessions. See [custom-resources.md](custom-resources.md) for the broader Resource authoring model.

## How It Works

1. **Check the current user with `getCurrentUser()`**: Call `this.getCurrentUser()` inside any Resource method to retrieve the authenticated user for the request. Returns `undefined` if no user is authenticated. The returned object exposes `username`, `role`, and `role.permission` flags.

   ```javascript
   async get(target) {
       const user = this.getCurrentUser();
       if (!user) return new Response(null, { status: 401 });
       return { username: user.username, role: user.role };
   }
   ```

2. **Access login and session via `getContext()`**: Call `this.getContext()` to obtain the request context. The context exposes `context.login` and `context.session` for sign-in and sign-out flows.

3. **Enable sessions in config**: Sessions require `authentication.enableSessions: true` in `harperdb-config.yaml` before `context.login` or `context.session` will function.

   ```yaml
   authentication:
     enableSessions: true
   ```

4. **Implement login**: Call `context.login(username, password)` to verify credentials and establish a session cookie on success. Catch errors and return a `403` on failure.

5. **Implement logout**: Access `context.session` to check for an active session, then call `context.session.delete(context.session.id)` to end it.

6. **Choose the right auth mechanism for your client**: Cookie-based sessions are intended for browser clients. For non-browser clients (CLI tools, mobile apps, service-to-service), use JWT issuance instead.

## Examples

### Sign-in and sign-out Resources

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

### Guarding a GET endpoint with `getCurrentUser()`

```javascript
async get(target) {
    const user = this.getCurrentUser();
    if (!user) return new Response(null, { status: 401 });
    return { username: user.username, role: user.role };
}
```

## Notes

- `getCurrentUser()` returns `undefined` for unauthenticated requests — always guard against this before accessing user properties.
- `context.login` establishes a session cookie; the client must support cookies for this flow to work.
- `enableSessions` must be set in `harperdb-config.yaml` or session-based login will not function.
- Cookie-based sessions are for browser clients only. For non-browser clients, use JWT-based authentication via `create_authentication_tokens` or a custom token-issuing Resource.
