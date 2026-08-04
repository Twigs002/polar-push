// Board - clean, screenshot-friendly team standings for Operation Polar Push.
// Polar Push branding up top, then total points and the mandate / sale
// breakdown per team. Built to be screenshotted (no app chrome in the card).
(function () {
  const { escapeHtml } = UTILS;
  const n = (v) => Number(v) || 0;

  function fmtDay(d) {
    return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
  }

  async function render($view) {
    $view.innerHTML = `<div class="loading">Loading standings…</div>`;
    let res;
    try {
      res = await DATA.loadStandings(true);
    } catch (e) {
      $view.innerHTML = `<div class="error-box">Could not load standings: ${escapeHtml(e.message || String(e))}</div>`;
      return;
    }
    if (!res.ready) {
      $view.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🛠️</div>
        <p>Standings aren't set up yet.</p></div>`;
      return;
    }

    // Every team is shown - the teams at the bottom should see they're behind.
    const rows = (res.standings || []).map((s) => ({
      team: s.team,
      total: n(s.total_points),
      mandates: n(s.mandate_count),
      sales: n(s.sale_count),
      mPts: s.mandate_points != null ? n(s.mandate_points) : null,
      sPts: s.sale_points != null ? n(s.sale_points) : null,
      entries: n(s.entry_count),
    }));
    rows.sort((a, b) => b.total - a.total || (a.team || "").localeCompare(b.team || ""));
    let place = 0, last = null;
    rows.forEach((r, i) => { if (r.total !== last) { place = i + 1; last = r.total; } r.rank = place; });

    // Traffic-light banding: no points yet = red (behind); of the teams that
    // have scored, the top third are green (leading), the rest amber.
    const scorers = rows.filter((r) => r.total > 0);
    const greenCut = Math.max(1, Math.ceil(scorers.length / 3));
    rows.forEach((r) => {
      if (r.total <= 0) { r.band = "red"; return; }
      r.band = scorers.indexOf(r) < greenCut ? "green" : "amber";
    });

    // Show the points split once the standings view carries it; until the
    // migration runs, fall back to plain deal counts.
    const hasPts = rows.some((r) => r.mPts != null);
    const start = new Date(POLAR.START + "T00:00:00");
    const end = new Date(POLAR.END + "T00:00:00");
    const asAt = new Date();

    const medal = (r) => r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : `<span class="pp-bd-num">${r}</span>`;
    const cell = (pts, count) => hasPts
      ? `<strong>${pts}</strong> <span class="pp-bd-sub">(${count})</span>`
      : `${count}`;
    const thSub = hasPts ? ` <span class="pp-bd-th-sub">pts (deals)</span>` : "";

    $view.innerHTML = `
      <div class="pp-board-page">
        <div class="pp-bd-toolbar"><button class="btn-primary pp-bd-export" id="pp-bd-export">⬇ Export PDF</button></div>
        <section class="pp-bd-hero">
          <div class="pp-bd-hero-icon" aria-hidden="true">⚡❄️</div>
          <div class="pp-bd-hero-eyebrow">Operation</div>
          <h1 class="pp-bd-hero-title">Polar&nbsp;Push</h1>
          <div class="pp-bd-hero-sub">${fmtDay(start)} - ${fmtDay(end)} 2026</div>
        </section>
        <div class="pp-bd-card">
          <h2 class="pp-bd-title">Team Standings</h2>
          <div class="pp-bd-legend">
            <span class="pp-bd-lg pp-bd-lg-green">Leading</span>
            <span class="pp-bd-lg pp-bd-lg-amber">In the mix</span>
            <span class="pp-bd-lg pp-bd-lg-red">Behind &ndash; no points yet</span>
          </div>
          ${rows.length ? `
          <div class="pp-table-wrap">
            <table class="pp-bd-table">
              <thead><tr>
                <th class="pp-bd-rankcol"></th>
                <th>Team</th>
                <th class="num">Mandates${thSub}</th>
                <th class="num">Sales${thSub}</th>
                <th class="num">Total points</th>
              </tr></thead>
              <tbody>
                ${rows.map((r) => `
                  <tr class="pp-bd-band-${r.band}">
                    <td class="pp-bd-rankcol">${medal(r.rank)}</td>
                    <td class="pp-bd-team">${escapeHtml(r.team || "")}</td>
                    <td class="num">${cell(r.mPts, r.mandates)}</td>
                    <td class="num">${cell(r.sPts, r.sales)}</td>
                    <td class="num pp-bd-total">${r.total}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
          <p class="pp-bd-foot">Verified deals only · as at ${asAt.toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
          ` : `<p class="muted" style="padding:24px;text-align:center">No verified deals on the board yet - it's all to play for.</p>`}
        </div>
      </div>`;

    const $exp = $view.querySelector("#pp-bd-export");
    if ($exp) $exp.addEventListener("click", () => window.print());
  }

  window.VIEWS = window.VIEWS || {};
  window.VIEWS["board"] = render;
})();
