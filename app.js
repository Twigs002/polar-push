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

  const $signin = document.getElementById("signin");
  // No PIN needed to watch the leaderboard / OTP tracking. Signing in unlocks
  // Submit (any active staff) and Admin (super/admin).
  const PUBLIC = { isPublic: true, isEditor: false, name: null };
  let _cache = null, _user = PUBLIC;

  function showLogin() { $loginError.hidden = true; $login.classList.remove("hidden"); $app.classList.add("hidden"); }

  function showApp(user) {
    $login.classList.add("hidden");
    $app.classList.remove("hidden");
    const authed = !!user && !user.isPublic;
    $signin.hidden = authed;
    $signout.hidden = !authed;
    $userLabel.hidden = !authed;
    document.querySelectorAll(".tabs a[data-auth]").forEach(a => a.hidden = !authed);
    document.querySelectorAll(".tabs a[data-editor]").forEach(a => a.hidden = !(authed && user.isEditor));
    if (authed) {
      const scope = user.isSuper ? " · super" : user.isAdmin ? " · admin" : (user.division ? ` · ${user.division}` : "");
      $userLabel.textContent = `${user.name}${scope}`;
    } else {
      $userLabel.textContent = "";
    }
    if (window.QuayNav) window.QuayNav.mount({ isSuper: authed && !!user.isSuper, current: "polar" });
  }

  function showError(msg) { $loginError.textContent = msg; $loginError.hidden = false; }

  $loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    $loginError.hidden = true;
    const username = document.getElementById("login-user").value;
    const pin = document.getElementById("login-pin").value;
    const r = await DATA.signIn(username, pin);
    if (!r.ok) { showError(r.error); return; }
    location.hash = "#/leaderboard";
    await boot(r.user);
  });

  $signin.addEventListener("click", () => showLogin());
  $signout.addEventListener("click", async () => { await DATA.signOut(); location.reload(); });
  // "← View the leaderboard" on the login screen: return to the (public) app.
  const $loginBack = document.getElementById("login-back");
  if ($loginBack) $loginBack.addEventListener("click", (e) => {
    e.preventDefault(); location.hash = "#/leaderboard"; showApp(_user); router(_user, _cache);
  });

  async function boot(user) {
    showApp(user);
    $view.innerHTML = '<div class="loading">Loading…</div>';
    let standings, full = { teams: [], entries: [] };
    try {
      standings = await DATA.loadStandings();
      if (user && !user.isPublic) {
        try { full = await DATA.loadAll(); } catch (e) { /* raw entries need auth; leaderboard uses the view */ }
      }
    } catch (e) {
      $view.innerHTML = `<div class="error-box">Could not load data: ${escapeHtml(e.message || String(e))}</div>`;
      return;
    }
    // Public users can't read the teams table, but the standings view carries
    // team names/ids - derive the submit dropdown from it when needed.
    const teamsFromStandings = (standings.standings || [])
      .map(s => ({ id: s.team_id, name: s.team, active: s.active, sort_order: s.sort_order }));
    _cache = {
      ready: standings.ready, standings: standings.standings,
      teams: (full.teams && full.teams.length) ? full.teams : teamsFromStandings,
      entries: full.entries,
    };
    _user = user;
    router(user, _cache);
  }

  function router(user, cache) {
    const tab = (location.hash || "#/leaderboard").replace(/^#\//, "");
    const authed = !!user && !user.isPublic;
    let valid = window.VIEWS[tab] ? tab : "leaderboard";
    if (valid === "admin" && !(authed && user.isEditor)) valid = "leaderboard";
    document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === valid));
    try {
      window.VIEWS[valid]($view, { user, cache });
    } catch (e) {
      console.error(e);
      $view.innerHTML = `<div class="error-box">Render error: ${escapeHtml(e.message || String(e))}</div>`;
    }
  }

  window.addEventListener("hashchange", () => router(_user, _cache));

  // Boot public by default; upgrade to the signed-in user if a session exists.
  (async () => {
    let user = PUBLIC;
    try { const existing = await DATA.getSession(); if (existing) user = existing; } catch (e) { /* stay public */ }
    await boot(user);
  })();
})();
