// Leaderboard - the competition scoreboard. Readable by all staff.
(function () {
  const { escapeHtml } = UTILS;

  // Standings come from the aggregate `polar_push_standings` view (public,
  // no deal-level detail), so the scoreboard works without a PIN.
  function computeStandings(cache) {
    const rows = (cache.standings || []).map(s => ({
      id: s.team_id, name: s.team, active: s.active, sort_order: s.sort_order,
      total: Number(s.total_points) || 0,
      mandates: Number(s.mandate_count) || 0,
      sales: Number(s.sale_count) || 0,
      entries: Number(s.entry_count) || 0,
    }));
    rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    // Dense rank so tied teams share a place.
    let place = 0, lastPts = null;
    rows.forEach((r, i) => {
      if (r.total !== lastPts) { place = i + 1; lastPts = r.total; }
      r.rank = place;
    });
    return rows;
  }

  // Competition clock: which week (1..8) and % elapsed.
  function timeline() {
    const start = new Date(POLAR.START + "T00:00:00");
    const end = new Date(POLAR.END + "T23:59:59");
    const now = new Date();
    const totalMs = end - start;
    const elapsed = Math.min(Math.max(now - start, 0), totalMs);
    const pct = totalMs > 0 ? (elapsed / totalMs) * 100 : 0;
    const week = now < start ? 0 : Math.min(8, Math.floor((now - start) / (7 * 864e5)) + 1);
    const daysLeft = Math.max(0, Math.ceil((end - now) / 864e5));
    let phase;
    if (now < start) phase = `Kicks off ${fmtDay(start)}`;
    else if (now > end) phase = "Competition closed";
    else phase = `Week ${week} of 8`;
    return { pct, week, phase, daysLeft, started: now >= start, ended: now > end };
  }

  function fmtDay(d) {
    return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
  }

  function medal(rank) {
    return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "";
  }

  // Dashboard-v2 style KPI tile: icon square + label + big value + footnote.
  function kpiTile(icon, label, value, foot) {
    return `<div class="pp-kpi">
      <div class="pp-kpi-ic">${icon}</div>
      <div class="pp-kpi-label">${label}</div>
      <div class="pp-kpi-val">${value}</div>
      <div class="pp-kpi-foot">${foot || ""}</div>
    </div>`;
  }

  // Live-refresh controller. render() is called by the router on each visit;
  // it paints instantly from the boot snapshot, pulls fresh standings, and
  // polls every 60s so a wall-mounted board stays current without a reload.
  let _timer = null;

  function render($view, ctx) {
    const user = ctx.user;
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (ctx.cache) paint($view, ctx.cache, user);   // instant paint from login snapshot
    refresh($view, user);                            // then pull the latest
    _timer = setInterval(() => {
      const active = document.querySelector(".tabs a.active");
      const onLeaderboard = !active || active.dataset.tab === "leaderboard";
      if (!onLeaderboard) { clearInterval(_timer); _timer = null; return; }
      refresh($view, user);
    }, 60000);
  }

  async function refresh($view, user) {
    const $btn = $view.querySelector("#pp-refresh");
    if ($btn) { $btn.disabled = true; $btn.classList.add("pp-spin"); }
    try {
      const res = await DATA.loadStandings(true);
      paint($view, { ready: res.ready, standings: res.standings, at: res.at }, user);
    } catch (e) {
      const $upd = $view.querySelector("#pp-updated");
      if ($upd) $upd.textContent = "refresh failed";
      const $b = $view.querySelector("#pp-refresh");
      if ($b) { $b.disabled = false; $b.classList.remove("pp-spin"); }
    }
  }

  function paint($view, cache, user) {
    if (!cache.ready) {
      $view.innerHTML = setupNotice(user);
      return;
    }
    if (!(cache.standings || []).length) {
      $view.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🏔️</div>
        <p>No teams yet.${user.isEditor ? " Add the competing teams from the <a href='#/admin'>Admin</a> tab." : " Ask an admin to set up the teams."}</p></div>`;
      return;
    }

    const rows = computeStandings(cache);
    const tl = timeline();
    const leader = rows[0];
    const maxPts = Math.max(1, ...rows.map(r => r.total));
    const totalEntries = rows.reduce((n, r) => n + r.entries, 0);
    const pendingCount = (cache.standings || []).reduce((n, s) => n + (Number(s.pending_count) || 0), 0);

    const podium = rows.slice(0, 3);

    const statusText = !tl.started ? "Not started yet" : tl.ended ? "Final" : `Week ${tl.week} of 8`;
    const [prizeDesc, prizeAmount] = (POLAR.PRIZE || "").split("·").map(s => s.trim());

    $view.innerHTML = `
      <section class="pp-banner">
        <div class="pp-banner-main">
          <div class="pp-banner-ic" aria-hidden="true">⚡❄️</div>
          <div class="pp-banner-body">
            <span class="pp-eyebrow">Operation · ${fmtDay(new Date(POLAR.START + "T00:00:00"))} - ${fmtDay(new Date(POLAR.END + "T00:00:00"))} 2026</span>
            <h1 class="pp-banner-title">Polar&nbsp;Push</h1>
            <div class="pp-banner-status">
              <span class="pp-status-pill">${escapeHtml(statusText)}</span>
              <span class="pp-banner-stat">${rows.length} teams · ${totalEntries} verified deal${totalEntries === 1 ? "" : "s"}</span>
            </div>
            <div class="pp-progress"><div class="pp-progress-fill" style="width:${tl.pct.toFixed(1)}%"></div></div>
          </div>
        </div>
        <div class="pp-banner-prize-panel">
          <span class="pp-prize-label">The Prize</span>
          <div class="pp-prize-desc">${escapeHtml(prizeDesc || "Prize")}</div>
          ${prizeAmount ? `<div class="pp-prize-value"><span class="pp-prize-amount">${escapeHtml(prizeAmount)}</span><span class="pp-prize-unit">value</span></div>` : ""}
        </div>
      </section>

      <div class="pp-kpis">
        ${kpiTile("🏆", "Leading team", leader && leader.total > 0 ? escapeHtml(leader.name) : "-", leader && leader.total > 0 ? `${leader.total} pts` : "all to play for")}
        ${kpiTile("✅", "Verified deals", String(totalEntries), "counting toward points")}
        ${kpiTile("👥", "Teams", String(rows.length), "in the running")}
        ${pendingCount
          ? kpiTile("⏳", "Pending", String(pendingCount), user.isEditor ? `<a href="#/admin">review now →</a>` : "awaiting verification")
          : kpiTile("📅", "Timeline", tl.started ? (tl.ended ? "Closed" : `${tl.daysLeft}d left`) : "Upcoming", tl.phase)}
      </div>

      ${podium.length >= 2 ? renderPodium(podium, tl) : ""}

      <section class="pp-board">
        <div class="pp-board-head">
          <h2>Standings</h2>
          ${leader && leader.total > 0 ? `<span class="pp-leader-note">${escapeHtml(leader.name)} out front${leader.total ? ` · ${leader.total} pts` : ""}</span>` : `<span class="pp-leader-note muted">No points on the board yet - it's all to play for.</span>`}
          <span class="pp-board-controls">
            <span class="muted small" id="pp-updated"></span>
            <button class="btn-ghost" id="pp-refresh" title="Re-check the standings">↻ Refresh</button>
          </span>
        </div>
        <div class="pp-rows">
          ${rows.map(r => rowHtml(r, maxPts)).join("")}
        </div>
      </section>
    `;

    const $refresh = $view.querySelector("#pp-refresh");
    if ($refresh) $refresh.addEventListener("click", () => refresh($view, user));
    const $upd = $view.querySelector("#pp-updated");
    if ($upd && cache.at) $upd.textContent = `updated ${UTILS.humanAgo(cache.at)}`;
  }

  function renderPodium(podium, tl) {
    // Visual order: 2nd, 1st, 3rd. Winner tallest.
    const order = [podium[1], podium[0], podium[2]].filter(Boolean);
    return `
      <section class="pp-podium ${tl.started ? "" : "pp-podium-pre"}">
        ${order.map(r => `
          <div class="pp-pod pp-pod-${r.rank}">
            <div class="pp-pod-medal">${medal(r.rank)}</div>
            <div class="pp-pod-name" title="${UTILS.escapeAttr(r.name)}">${UTILS.escapeHtml(r.name)}</div>
            <div class="pp-pod-pts">${r.total}<span>pts</span></div>
            <div class="pp-pod-bar"></div>
          </div>`).join("")}
      </section>`;
  }

  function rowHtml(r, maxPts) {
    const w = maxPts ? (r.total / maxPts) * 100 : 0;
    const top = r.rank <= 3 ? `pp-row-top pp-row-${r.rank}` : "";
    return `
      <div class="pp-row ${top}">
        <div class="pp-rank">${medal(r.rank) || `<span class="pp-rank-num">${r.rank}</span>`}</div>
        <div class="pp-row-body">
          <div class="pp-row-top-line">
            <span class="pp-team">${UTILS.escapeHtml(r.name)}</span>
            <span class="pp-pts">${r.total}<span class="pp-pts-unit">pts</span></span>
          </div>
          <div class="pp-bar-track"><div class="pp-bar-fill" style="width:${Math.max(w, r.total > 0 ? 4 : 0)}%"></div></div>
          <div class="pp-row-meta">
            <span title="Mandates counted">📋 ${r.mandates} mandate${r.mandates === 1 ? "" : "s"}</span>
            <span title="Sales & leases counted">🤝 ${r.sales} sale${r.sales === 1 ? "" : "s"}</span>
          </div>
        </div>
      </div>`;
  }

  function setupNotice(user) {
    return `<div class="empty-state"><div class="empty-state-icon">🛠️</div>
      <p>The Polar Push tables aren't set up in Supabase yet.</p>
      <p class="muted small">Run <code>supabase/migrations/2026-07-31_polar_push.sql</code> against the project, then reload.</p></div>`;
  }

  window.VIEWS = window.VIEWS || {};
  window.VIEWS["leaderboard"] = render;
})();
