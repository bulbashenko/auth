# auth

Single sign-on for a small group of people: one account, a passkey (or password + TOTP), every service.

- **[Authelia](https://www.authelia.com)** is the OpenID Connect provider and the login portal. It also serves Traefik forward-auth for apps that have no login of their own.
- **[LLDAP](https://github.com/lldap/lldap)** holds users and groups, has a web UI to manage them, and speaks LDAP to apps that need it.
- **Valkey** keeps login sessions across restarts.

Altogether it runs in about 100 MB of RAM. The stack is a Docker Compose file meant to be deployed by [Coolify](https://coolify.io) straight from this repository. It runs anywhere Compose runs if you fill in the variables yourself.

It powers `auth.bulbashenko.com`. The deployment-specific part is [`authelia/instance.yml`](authelia/instance.yml); everything else is generic.

## Layout

| Path | What it is |
|---|---|
| `compose.yml` | The four services and every variable they read. |
| `authelia/configuration.yml` | Generic Authelia settings: login methods, LDAP, sessions, storage, mail, signing key. |
| `authelia/instance.yml` | This deployment's OIDC clients, access policies and CORS origins. |
| `lldap/bootstrap/` | One-shot job that creates the groups and the `authelia` bind user. |
| `thunderbird-addon/` | Tiny add-on that makes Thunderbird sign in to `@bulbashenko.com` through Authelia, as it does for Gmail. |
| `scripts/` | Helpers that generate the signing key and client secrets. |

## Sign-in

- **Passkey** is the primary method, and on its own satisfies the `two_factor` policy (only authenticators that verify the user, by PIN or biometrics). This relies on Authelia's experimental `experimental_enable_passkey_uv_two_factors`; re-check it when upgrading Authelia.
- **Password + TOTP** is the fallback.
- There is no self-registration. An admin creates users in LLDAP; users then set their password through "Reset password" and enroll a passkey or TOTP in the portal. Enrollment sends a one-time code by email.

Groups decide access:

| Group | Grants |
|---|---|
| `infra-admins` | Cloudflare Access (admin panels) and every forward-auth app by default |
| `site-admins` | The bulbashenko.com admin panel |
| `mail-users` | Mail clients and the Stalwart web UI |
| `lldap_password_manager` | Built-in LLDAP group; only the `authelia` service user is in it |

## Deploy on Coolify

1. **Databases.** Create two databases with their own roles in an existing Postgres, `authelia` and `lldap`:
   ```sql
   CREATE ROLE authelia LOGIN PASSWORD '...'; CREATE DATABASE authelia OWNER authelia;
   CREATE ROLE lldap LOGIN PASSWORD '...';    CREATE DATABASE lldap OWNER lldap;
   ```
2. **Application.** + New → Public repository → this repo → Build strategy **Compose**, compose file `compose.yml`. Then:
   - General → Build pipeline: turn on **Preserve repository during deployment**. The config files are bind-mounted from the checkout.
   - Advanced: turn on **Connect to predefined network**, so the stack can reach Postgres and other apps can reach LDAP on `lldap:3890`.
   - Domains: `authelia` → `https://auth.example.com`, `lldap` → `https://users.example.com`. Coolify routes each domain to the service's first `expose` port. Put the LLDAP UI behind another access layer, such as Cloudflare Access.
3. **Environment variables.** Coolify generates every `SERVICE_PASSWORD_*` value. Fill in the rest:

   | Variable | Example / how to get it |
   |---|---|
   | `AUTH_PORTAL_URL` | `https://auth.example.com` |
   | `AUTH_COOKIE_DOMAIN` | `example.com` (the portal must live under it) |
   | `LDAP_BASE_DN` | `dc=example,dc=com` |
   | `POSTGRES_HOST` | container name of the Postgres resource |
   | `AUTHELIA_DB_PASSWORD` | password of the `authelia` role |
   | `LLDAP_DATABASE_URL` | `postgres://lldap:<password>@<host>/lldap` |
   | `LLDAP_HTTP_URL` | `https://users.example.com` |
   | `LLDAP_ADMIN_EMAIL`, `LDAP_BIND_EMAIL` | any addresses you control |
   | `SMTP_ADDRESS` | `submissions://mail.example.com:465` |
   | `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_SENDER` | a mailbox for login codes, e.g. `noreply@` |
   | `OIDC_JWK_RS256_B64` | `scripts/gen-jwk.sh` |
   | `OIDC_*_SECRET_DIGEST` | second line of `scripts/new-client-secret.sh`; the first line goes to the app |
   | `CLOUDFLARE_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` |

   Mark the `OIDC_*_SECRET_DIGEST` values as **literal**. PBKDF2 digests contain `$`, which Coolify would otherwise try to interpolate.
4. **Deploy.** Then sign in to the LLDAP UI as `lldap-admin`. The password is `SERVICE_PASSWORD_LLDAPADMIN`; change it there. Create the people and put them in groups.

## Add a service

**App that supports OpenID Connect.**
1. Run `scripts/new-client-secret.sh`.
2. Add a client to `authelia/instance.yml`, using an `authorization_policy` that limits it to a group.
3. Pass the digest through a new `OIDC_*_SECRET_DIGEST` variable.
4. Push and redeploy.

The app needs these settings:
- issuer `https://auth.example.com`
- client id and secret
- scopes `openid profile email groups`

**App without any login.**
1. Add a forward-auth middleware to its Traefik labels:
   ```
   traefik.http.middlewares.authelia.forwardauth.address=http://<authelia-container>:9091/api/authz/forward-auth
   traefik.http.middlewares.authelia.forwardauth.trustForwardHeader=true
   traefik.http.middlewares.authelia.forwardauth.authResponseHeaders=Remote-User,Remote-Groups,Remote-Email,Remote-Name
   traefik.http.routers.<router>.middlewares=authelia
   ```
2. Add an `access_control` rule for its domain in `instance.yml`. Without one, only `infra-admins` get in.

**App that needs LDAP.** Point it at `ldap://lldap:3890` with base DN `LDAP_BASE_DN`. Bind as a dedicated LLDAP user in the `lldap_strict_readonly` group.

## Thunderbird

Thunderbird 155+ supports OAuth for any mail server, but it has to be told the provider. The add-on does exactly that for `@bulbashenko.com`. It contains a manifest only, no code.

1. Build it with `thunderbird-addon/build.sh`.
2. Install it: Add-ons and Themes → ⚙ → Install Add-on From File.
3. Add the account. Thunderbird opens the browser at the Authelia portal.

On other mail domains, change `oauth_provider` in `manifest.json` and the `thunderbird` client in `instance.yml`.

Phones (Thunderbird for Android, Apple Mail, FairEmail) cannot use custom OAuth yet. For them, create an app password in the mail server's account settings.

## Notes

- The mail server (Stalwart) validates Authelia's JWT access tokens offline. Mail clients get the `stalwart` audience and the `mail` claims policy for that reason. Stalwart reads scopes from `scope`, while Authelia writes `scp`; leave Stalwart's `requireScopes` empty and rely on the audience.
- Authelia 4.39 has no end-session endpoint. Signing out of an app does not sign you out of the portal.
- Rotating `OIDC_JWK_RS256_B64` invalidates every token that has been issued.

## License

MIT, except `lldap/bootstrap/bootstrap.sh`, which is vendored from LLDAP under GPL-3.0.
