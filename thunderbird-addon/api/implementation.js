/* Experiment API: privileged code, runs in Thunderbird's parent process. ExtensionCommon, Services and Ci are globals here. */
"use strict";

var { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
var { OAuth2Module } = ChromeUtils.importESModule("resource:///modules/OAuth2Module.sys.mjs");

function loginOrigin(issuer) {
  return "oauth://" + issuer;
}

// Outgoing servers moved from MailServices.smtp to MailServices.outgoingServer in Thunderbird 128.
function outgoingServers() {
  const service = MailServices.outgoingServer ?? MailServices.smtp;
  return [...(service?.servers ?? [])];
}

// nsIMsgIncomingServer.hostName became hostname in recent Thunderbird versions.
function incomingHost(server) {
  return (server.hostname ?? server.hostName ?? "").toLowerCase();
}

function outgoingHost(server) {
  try {
    return server.serverURI.host.toLowerCase();
  } catch {
    return "";
  }
}

var oauthTokens = class extends ExtensionCommon.ExtensionAPI {
  getAPI() {
    return {
      oauthTokens: {
        async list(issuer) {
          const logins = await Services.logins.searchLoginsAsync({ origin: loginOrigin(issuer) });
          return logins.map(login => ({ username: login.username, scope: login.httpRealm }));
        },

        async clear(issuer, hostnames, portalHost) {
          const hosts = new Set(hostnames.map(h => h.toLowerCase()));
          const result = { servers: 0, logins: 0, cookies: 0 };

          // Clearing through OAuth2Module also resets the in-memory OAuth2 object that open connections share.
          for (const server of MailServices.accounts.allServers) {
            if (!hosts.has(incomingHost(server)) || server.authMethod != Ci.nsMsgAuthMethod.OAuth2) {
              continue;
            }
            const module = new OAuth2Module();
            if (module.initFromMail(server)) {
              await module.clearTokens();
              result.servers++;
            }
            server.closeCachedConnections();
          }
          for (const server of outgoingServers()) {
            if (!hosts.has(outgoingHost(server)) || server.authMethod != Ci.nsMsgAuthMethod.OAuth2) {
              continue;
            }
            const module = new OAuth2Module();
            if (module.initFromOutgoing(server)) {
              await module.clearTokens();
              result.servers++;
            }
          }

          // Anything left for this issuer, e.g. from an account that no longer exists.
          for (const login of await Services.logins.searchLoginsAsync({ origin: loginOrigin(issuer) })) {
            await Services.logins.removeLoginAsync(login);
            result.logins++;
          }

          if (portalHost) {
            for (const cookie of Services.cookies.getCookiesFromHost(portalHost, {})) {
              Services.cookies.remove(cookie.host, cookie.name, cookie.path, cookie.originAttributes);
              result.cookies++;
            }
          }
          return result;
        },
      },
    };
  }
};
