"use strict";

const t = (key, ...subs) => browser.i18n.getMessage(key, subs);
const { issuer, hostnames } = browser.runtime.getManifest().oauth_provider;
const portalHost = new URL(browser.runtime.getManifest().oauth_provider.authorizationEndpoint).host;

for (const el of document.querySelectorAll("[data-i18n]")) {
  el.textContent = t(el.dataset.i18n);
}
document.getElementById("portal-label").textContent = t("signOutPortal", portalHost);

const list = document.getElementById("tokens");
const status = document.getElementById("status");
const button = document.getElementById("clear");

function setStatus(text, isError = false) {
  status.textContent = text;
  status.classList.toggle("error", isError);
}

async function refresh() {
  const tokens = await browser.oauthTokens.list(issuer);
  list.replaceChildren();
  if (!tokens.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = t("noTokens");
    list.append(li);
  }
  for (const token of tokens) {
    const li = document.createElement("li");
    li.textContent = token.username;
    list.append(li);
  }
  return tokens.length;
}

button.addEventListener("click", async () => {
  if (!confirm(t("confirmClear"))) {
    return;
  }
  button.disabled = true;
  setStatus("");
  try {
    const portal = document.getElementById("portal").checked ? portalHost : undefined;
    await browser.oauthTokens.clear(issuer, hostnames, portal);
    await refresh();
    setStatus(t("cleared"));
  } catch (err) {
    setStatus(t("clearFailed", String(err?.message ?? err)), true);
  } finally {
    button.disabled = false;
  }
});

refresh().catch(err => setStatus(t("clearFailed", String(err?.message ?? err)), true));
