// OTP tracking - accepted sales pulled daily from the front-office sheet.
// Public (readable without a PIN) via the polar_push_otps_public view.
(function () {
  const { escapeHtml } = UTILS;

  function money(v) { return "R" + (Number(v) || 0).toLocaleString("en-ZA"); }
  function fmtDate(s) {
    if (!s) return "";
    const d = new Date(s);
    return isNaN(d) ? "" : d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  }

  async function load($view, force) {
    const $body = $view.querySelector("#otp-body");
    const $meta = $view.querySelector("#otp-meta");
    const $btn = $view.querySelector("#otp-refresh");
    if ($btn) { $btn.disabled = true; $btn.classList.add("pp-spin"); }
    try {
      const res = await DATA.loadOtps(force);
      if (!res.ready) {
        $body.innerHTML = `<tr><td colspan="4" class="pp-otp-empty">OTP tracking isn't set up yet.</td></tr>`;
        $meta.textContent = "";
      } else if (!res.otps.length) {
        $body.innerHTML = `<tr><td colspan="4" class="pp-otp-empty">No OTPs yet - accepted sales from 1 Aug appear here once the daily sync runs.</td></tr>`;
        $meta.textContent = `Updated ${UTILS.humanAgo(res.at)}`;
      } else {
        $body.innerHTML = res.otps.map(o => `<tr>
          <td>${escapeHtml(o.team || "")}</td>
          <td>${escapeHtml(fmtDate(o.acceptance_date))}</td>
          <td class="num">${money(o.amount)}</td>
          <td class="num"><strong>${Number(o.points) || 0}</strong></td>
        </tr>`).join("");
        const totalPts = res.otps.reduce((n, o) => n + (Number(o.points) || 0), 0);
        $meta.textContent = `${res.otps.length} OTP${res.otps.length === 1 ? "" : "s"} · ${totalPts} pts · updated ${UTILS.humanAgo(res.at)}`;
      }
    } catch (e) {
      $body.innerHTML = `<tr><td colspan="4" class="pp-otp-empty">Could not load OTPs: ${escapeHtml(e.message || String(e))}</td></tr>`;
    } finally {
      if ($btn) { $btn.disabled = false; $btn.classList.remove("pp-spin"); }
    }
  }

  function render($view) {
    $view.innerHTML = `
      <div class="pp-card">
        <div class="pp-card-head">
          <div>
            <h2>OTP tracking</h2>
            <div class="muted small" id="otp-meta">Loading…</div>
          </div>
          <button class="btn-ghost" id="otp-refresh" title="Re-check for new OTPs">↻ Refresh</button>
        </div>
        <p class="muted">Accepted sales (OTPs) pulled from the front-office sheet once a day. Points are allocated per the R5m brackets.</p>
        <div class="pp-table-wrap">
          <table class="pp-entries">
            <thead><tr>
              <th>Team</th><th>Acceptance date</th>
              <th class="num">Amount</th><th class="num">Points allocated</th>
            </tr></thead>
            <tbody id="otp-body"><tr><td colspan="4" class="pp-otp-empty">Loading…</td></tr></tbody>
          </table>
        </div>
      </div>`;
    $view.querySelector("#otp-refresh").addEventListener("click", () => { DATA.invalidateOtps(); load($view, true); });
    load($view, false);
  }

  window.VIEWS = window.VIEWS || {};
  window.VIEWS["otps"] = render;
})();
