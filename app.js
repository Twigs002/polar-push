// Bootstrap: auth → load → router.
(function () {
  const { escapeHtml } = UTILS;
  const $login = document.getElementById("login");
  const $app = document.getElementById("app");
  const $loginForm = document.getElementById("login-form");
  const $loginError = document.getElementById("login-error");
  const $userLabel = document.getElementById("user-label");
  const $signout = document.getElementById("signout");
  const $view = document.getElementById("view");

  // Global toast - title/body are trusted HTML; callers escape dynamic bits.
  window.toast = function ({ title, body = "", ms = 4000 }) {
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = `<div class="toast-title">${escapeHtml(title)}</div>${body ? `<div>${body}</div>` : ""}`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, ms);
  };

  function showLogin() { $login.classList.remove("hidden"); $app.classList.add("hidden"); }

  function showApp(user) {
    $login.classList.add("hidden");
    $app.classList.remove("hidden");
    const scope = user.isSuper ? " · super" : user.isAdmin ? " · admin" : (user.division ? ` · ${user.division}` : "");
    $userLabel.textContent = `${user.name}${scope}`;
    // Reveal editor-only tabs.
    if (user.isEditor) document.querySelectorAll(".tabs a[data-editor]").forEach(a => a.hidden = false);
    // Shared cross-app switcher on the Quay 1 flag (superusers only; no-op else).
    if (window.QuayNav) window.QuayNav.mount({ isSuper: !!user.isSuper, current: "polar" });
  }

  function showError(msg) { $loginError.textContent = msg; $loginError.hidden = false; }

  $loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    $loginError.hidden = true;
    const username = document.getElementById("login-user").value;
    const pin = document.getElementById("login-pin").value;
    const r = await DATA.signIn(username, pin);
    if (!r.ok) { showError(r.error); return; }
    await boot(r.user);
  });

  $signout.addEventListener("click", async () => { await DATA.signOut(); location.reload(); });

  async function boot(user) {
    showApp(user);
    $view.innerHTML = '<div class="loading">Loading…</div>';
    let cache;
    try {
      cache = await DATA.loadAll();
    } catch (e) {
      $view.innerHTML = `<div class="error-box">Could not load data: ${escapeHtml(e.message || String(e))}</div>`;
      return;
    }
    window.addEventListener("hashchange", () => router(user, cache));
    router(user, cache);
  }

  function router(user, cache) {
    const tab = (location.hash || "#/leaderboard").replace(/^#\//, "");
    const valid = window.VIEWS[tab] ? tab : "leaderboard";
    // Guard editor-only routes.
    const finalTab = (valid === "admin" && !user.isEditor) ? "leaderboard" : valid;
    document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === finalTab));
    try {
      window.VIEWS[finalTab]($view, { user, cache });
    } catch (e) {
      console.error(e);
      $view.innerHTML = `<div class="error-box">Render error: ${escapeHtml(e.message || String(e))}</div>`;
    }
  }

  // Session restore.
  (async () => {
    const existing = await DATA.getSession();
    if (existing) await boot(existing);
    else showLogin();
  })();
})();
