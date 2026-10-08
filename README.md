# auth

Single sign-on for a small group of people: one account, a passkey (or password + TOTP), every service.

- **[Authelia](https://www.authelia.com)** is the OpenID Connect provider and the login portal. It also serves Traefik forward-auth for apps that have no login of their own.
- **[LLDAP](https://github.com/lldap/lldap)** holds users and groups, has a web UI to manage them, and speaks LDAP to apps that need it.
- **Valkey** keeps login sessions across restarts.
- **nginx** serves the portal with the look of bulbashenko.com.

Altogether it runs in about 100 MB of RAM. The stack is a Docker Compose file meant to be deployed by [Coolify](https://coolify.io) straight from this repository. It runs anywhere Compose runs if you fill in the variables yourself.

It powers `auth.bulbashenko.com`. The deployment-specific parts are [`authelia/instance.yml`](authelia/instance.yml) and the portal theme in [`theme/`](theme/); everything else is generic.

## Layout

| Path | What it is |
|---|---|
| `compose.yml` | The five services and every variable they read. |
| `authelia/configuration.yml` | Generic Authelia settings: login methods, LDAP, sessions, storage, mail, signing key. |
| `authelia/instance.yml` | This deployment's OIDC clients, access policies and CORS origins. |
| `theme/` | The portal's look: an nginx proxy in front of Authelia that adds `public/theme.css` (and its fonts) to every page. |
| `lldap/bootstrap/` | One-shot job that creates the groups and the `authelia` bind user. |
| `thunderbird-addon/` | Add-on that makes Thunderbird sign in to `@bulbashenko.com` through Authelia, as it does for Gmail, with an options page to remove saved tokens. |
| `scripts/` | Helpers that generate the signing key and client secrets. |

## Sign-in

- **Passkey** is the primary method, and on its own satisfies the `two_factor` policy (only authenticators that verify the user, by PIN or biometrics). This relies on Authelia's experimental `experimental_enable_passkey_uv_two_factors`; re-check it when upgrading Authelia.
- **Password + TOTP** is the fallback.
- There is no self-registration. An admin creates users in LLDAP; users then set their password through "Reset password" and enroll a passkey or TOTP in the portal. Enrollment sends a one-time code by email.

Groups decide access:

| Group | Grants |
|---|---|
| `infra-admins` | Admin panels: every forward-auth app by default |
| `site-admins` | The bulbashenko.com admin panel |
| `mail-users` | Mail clients and the Stalwart web UI |
| `vpn-users` | Joining the VPN mesh (Headscale) |
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
   - Domains: `portal` → `https://auth.example.com`, `lldap` → `https://users.example.com`. Coolify routes each domain to the service's first `expose` port. Put the LLDAP UI behind another access layer, such as Authelia forward-auth or a VPN.
3. **Environment variables.** Coolify generates every `SERVICE_PASSWORD_*` value. Fill in the rest:

   | Variable | Example / how to get it |
   |---|---|
   | `AUTH_PORTAL_URL` | `https://auth.example.com` |
   | `AUTH_COOKIE_DOMAIN` | `example.com` (the portal must live under it) |
   | `LDAP_BASE_DN` | `dc=example,dc=com` |
   | `POSTGRES_HOST` | container name of the Postgres resource |
   | `AUTH_DB_PASSWORD` | password of the `authelia` role |
   | `LLDAP_DATABASE_URL` | `postgres://lldap:<password>@<host>/lldap` |
   | `LLDAP_HTTP_URL` | `https://users.example.com` |
   | `LLDAP_ADMIN_EMAIL`, `LDAP_BIND_EMAIL` | any addresses you control |
   | `SMTP_ADDRESS` | `submissions://mail.example.com:465`, or `submissions://host.docker.internal:465` when the mail server runs on the same host |
| `SMTP_TLS_SERVER_NAME` | optional: the certificate name (e.g. `mail.example.com`) when `SMTP_ADDRESS` uses another host name |
   | `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_SENDER` | a mailbox for login codes, e.g. `noreply@` |
   | `OIDC_JWK_RS256_B64` | `scripts/gen-jwk.sh` |
   | `OIDC_*_SECRET_DIGEST_B64` | second line of `scripts/new-client-secret.sh`; the first line goes to the app |

   Digests are passed in Base64 because they contain `$`, which Compose would interpolate.
4. **Deploy.** Then sign in to the LLDAP UI as `lldap-admin`. The password is `SERVICE_PASSWORD_LLDAPADMIN`; change it there. Create the people and put them in groups.

## Add a service

**App that supports OpenID Connect.**
1. Run `scripts/new-client-secret.sh`.
2. Add a client to `authelia/instance.yml`, using an `authorization_policy` that limits it to a group.
3. Pass the digest through a new `OIDC_*_SECRET_DIGEST_B64` variable.
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

   If the app's labels are not yours to edit (a Coolify one-click service), put the middleware and a higher-priority router in a Traefik dynamic configuration file instead (Coolify: Servers → Proxy → Dynamic Configurations). The middleware address is `http://authelia:9091/api/authz/forward-auth`, since Authelia is on the `coolify` network under its service name.

**App that needs LDAP.** Point it at `ldap://lldap:3890` with base DN `LDAP_BASE_DN`. Bind as a dedicated LLDAP user in the `lldap_strict_readonly` group.

## Thunderbird

Thunderbird 155+ supports OAuth for any mail server, but it has to be told the provider. The add-on does exactly that for `@bulbashenko.com`.

1. Build it with `thunderbird-addon/build.sh`.
2. Install it: Add-ons and Themes → ⚙ → Install Add-on From File.
3. Add the account, or switch an existing one to OAuth2 for both IMAP and SMTP. Thunderbird opens the Authelia portal in its own window. To use the system browser instead, set `useExternalBrowser` to `true`; the redirect then goes to a random loopback port.

On other mail domains, change `oauth_provider` in `manifest.json` and the `thunderbird` client in `instance.yml`.

To sign in again (another account, a changed password): Add-ons and Themes → the add-on → Options → **Remove OAuth tokens**. It clears the saved refresh token, the access token in memory and open connections. Optionally it also drops the portal cookies, so the next sign-in asks for a passkey or password. That button needs a small Experiment API (`api/`), so Thunderbird shows the add-on as having full access.

Phones (Thunderbird for Android, Apple Mail, FairEmail) cannot use custom OAuth yet. For them, create an app password in the mail server's account settings.

## Theme

Authelia has no setting for custom CSS: `server.asset_path` only replaces the logo, the favicon and translations. So the `portal` service, a plain nginx, proxies Authelia and inserts `<link rel="stylesheet" href="/_theme/theme.css">` before `</head>` of every HTML page, and serves `theme/public/` under `/_theme/`. The stylesheet is same-origin, which Authelia's Content Security Policy allows; the fonts are served locally for the same reason (the policy blocks Google Fonts).

- Authelia 4.39's UI is Tailwind with shadcn-style colour variables. `theme.css` mostly remaps those, and otherwise hooks onto ids and `data-slot`/`data-variant` attributes, not generated class names. After an Authelia upgrade, go through the screens anyway: sign-in, second factor, consent, reset password, settings and the TOTP and passkey dialogs.
- To change the look, edit `theme/public/theme.css`, push and redeploy. The file is served with `Cache-Control: no-cache`, so browsers pick it up at once.
- To drop the theme, remove the `portal` service and give the auth domain back to `authelia`.

Fonts: Tiny5 and Bitcount Single, both under the SIL Open Font License 1.1.

## Notes

- The mail server (Stalwart) validates Authelia's JWT access tokens offline. Mail clients get the `stalwart` audience and the `mail` claims policy for that reason. Stalwart reads scopes from `scope`, while Authelia writes `scp`; leave Stalwart's `requireScopes` empty and rely on the audience.
- Authelia 4.39 has no end-session endpoint. Signing out of an app does not sign you out of the portal.
- Rotating `OIDC_JWK_RS256_B64` invalidates every token that has been issued.

## License

MIT, except `lldap/bootstrap/bootstrap.sh`, which is vendored from LLDAP under GPL-3.0.
