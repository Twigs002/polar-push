// Admin - add verified deals, void/delete entries, manage teams.
// Super/admin only (RLS also enforces this server-side).
(function () {
  const { escapeHtml, escapeAttr } = UTILS;

  function money(v) {
    return "R" + (Number(v) || 0).toLocaleString("en-ZA");
  }
  function fmtDate(s) {
    if (!s) return "";
    const d = new Date(s);
    return isNaN(d) ? "" : d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  }

  async function rerender($view, user) {
    const cache = await DATA.loadAll(true);
    render($view, { cache, user });
  }

  function render($view, ctx) {
    const { cache, user } = ctx;

    if (!user.isEditor) {
      $view.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔒</div>
        <p>Admin access only. Standings are on the <a href="#/leaderboard">Leaderboard</a> tab.</p></div>`;
      return;
    }
    if (!cache.ready) {
      $view.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🛠️</div>
        <p>Run the migration <code>supabase/migrations/2026-07-31_polar_push.sql</code> first, then reload.</p></div>`;
      return;
    }

    const teams = [...cache.teams].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
    const activeTeams = teams.filter(t => t.active);
    const entries = cache.entries; // already newest-first
    const pending = entries.filter(e => e.status === "pending");
    const decided = entries.filter(e => e.status !== "pending");

    $view.innerHTML = `
      <div class="pp-admin">
        ${pending.length ? `
        <div class="pp-card pp-pending-card">
          <div class="pp-card-head">
            <h2>Pending verification <span class="pp-count-badge">${pending.length}</span></h2>
            <span class="muted small">Broker submissions awaiting sign-off</span>
          </div>
          ${pendingTable(pending, teams)}
        </div>` : ""}

        <div class="pp-card pp-entry-card">
          <h2>Add a verified deal</h2>
          ${activeTeams.length ? "" : `<p class="pp-warn">Add a team below before logging deals.</p>`}
          <form id="entry-form" class="pp-form" ${activeTeams.length ? "" : "hidden"}>
            <div class="pp-form-grid">
              <label>Team
                <select name="team_id" required>
                  <option value="">Select team…</option>
                  ${activeTeams.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}
                </select>
              </label>
              <label>Deal type
                <select name="deal_type" required>
                  ${POINTS.TYPES.map(t => `<option value="${t.key}">${escapeHtml(t.label)}</option>`).join("")}
                </select>
              </label>
              <label>Value (R)
                <input name="value_rand" type="text" inputmode="numeric" placeholder="e.g. 12 500 000" required>
              </label>
              <label>Signed date
                <input name="signed_date" type="date">
              </label>
              <label>Agent <span class="opt">(optional)</span>
                <input name="agent_name" type="text" placeholder="Who earned it">
              </label>
              <label>Reference <span class="opt">(optional)</span>
                <input name="reference" type="text" placeholder="Property / deal ref">
              </label>
            </div>
            <label class="pp-notes">Notes <span class="opt">(optional)</span>
              <input name="notes" type="text" placeholder="Anything worth recording">
            </label>
            <div class="pp-form-foot">
              <div class="pp-preview">This deal is worth <strong id="entry-pts">0</strong> points <span id="entry-bracket" class="muted"></span></div>
              <button type="submit" class="btn-primary" id="entry-submit">Add deal</button>
            </div>
          </form>
        </div>

        <div class="pp-card">
          <div class="pp-card-head">
            <h2>Verified &amp; decided deals</h2>
            <span class="muted small">${decided.length} total${decided.some(e => e.voided) ? ` · ${decided.filter(e => e.voided).length} voided` : ""}</span>
          </div>
          ${decided.length ? entriesTable(decided, teams) : `<p class="muted">No verified deals yet.</p>`}
        </div>

        <div class="pp-card">
          <div class="pp-card-head">
            <h2>Teams</h2>
            <span class="muted small">${teams.length} team${teams.length === 1 ? "" : "s"}</span>
          </div>
          <div class="pp-teams">
            ${teams.map(t => teamRow(t)).join("")}
          </div>
          <form id="team-form" class="pp-team-add">
            <input name="name" type="text" placeholder="New team name" required>
            <button type="submit" class="btn-ghost">Add team</button>
          </form>
        </div>
      </div>`;

    wire($view, user, teams);
  }

  function statusPill(e) {
    if (e.voided) return `<span class="pp-status pp-st-voided">Voided</span>`;
    if (e.status === "verified") return `<span class="pp-status pp-st-verified">Verified</span>`;
    if (e.status === "rejected") return `<span class="pp-status pp-st-rejected">Rejected</span>`;
    return `<span class="pp-status pp-st-pending">Pending</span>`;
  }

  // Pending queue - the action-first table an admin verifies from.
  function pendingTable(entries, teams) {
    const teamName = id => (teams.find(t => t.id === id) || {}).name || "-";
    return `<div class="pp-table-wrap">
      <table class="pp-entries pp-pending-table">
        <thead><tr>
          <th>Team</th><th>Type</th><th class="num">Value</th><th class="num">Pts</th>
          <th>Signed</th><th>Submitted by</th><th>Ref</th><th></th>
        </tr></thead>
        <tbody>
          ${entries.map(e => `
            <tr>
              <td>${escapeHtml(teamName(e.team_id))}</td>
              <td>${escapeHtml(POINTS.typeLabel(e.deal_type))}</td>
              <td class="num">${money(e.value_rand)}</td>
              <td class="num"><strong>${e.points}</strong></td>
              <td>${escapeHtml(fmtDate(e.signed_date))}</td>
              <td>${escapeHtml(e.submitted_by_name || e.agent_name || "")}</td>
              <td title="${escapeAttr(e.reference || "")}">${escapeHtml(UTILS.trunc(e.reference || "", 16) || "")}</td>
              <td class="pp-actions">
                <button class="pp-mini pp-approve" data-verify="${e.id}" title="Verify - counts toward standings">✓ Verify</button>
                <button class="pp-mini pp-danger" data-reject="${e.id}" title="Reject submission">Reject</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function entriesTable(entries, teams) {
    const teamName = id => (teams.find(t => t.id === id) || {}).name || "-";
    return `<div class="pp-table-wrap">
      <table class="pp-entries">
        <thead><tr>
          <th>Team</th><th>Type</th><th class="num">Value</th><th class="num">Pts</th>
          <th>Signed</th><th>Agent</th><th>Status</th><th></th>
        </tr></thead>
        <tbody>
          ${entries.map(e => `
            <tr class="${e.voided ? "pp-voided" : ""} ${e.status === "rejected" ? "pp-rejected-row" : ""}">
              <td>${escapeHtml(teamName(e.team_id))}</td>
              <td>${escapeHtml(POINTS.typeLabel(e.deal_type))}</td>
              <td class="num">${money(e.value_rand)}</td>
              <td class="num"><strong>${(e.status === "verified" && !e.voided) ? e.points : "0"}</strong>${(e.voided || e.status === "rejected") ? `<span class="pp-strike">${e.points}</span>` : ""}</td>
              <td>${escapeHtml(fmtDate(e.signed_date))}</td>
              <td>${escapeHtml(e.agent_name || e.submitted_by_name || "")}</td>
              <td>${statusPill(e)}</td>
              <td class="pp-actions">
                ${e.status === "verified" ? `<button class="pp-mini" data-void="${e.id}" data-cur="${e.voided ? 1 : 0}" title="${e.voided ? "Restore points" : "Void - deal fell through"}">${e.voided ? "↺ Restore" : "Void"}</button>` : ""}
                ${e.status === "rejected" ? `<button class="pp-mini pp-approve" data-verify="${e.id}" title="Verify after all">✓ Verify</button>` : ""}
                <button class="pp-mini pp-danger" data-del="${e.id}" title="Delete permanently">✕</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function teamRow(t) {
    return `<div class="pp-team-row ${t.active ? "" : "pp-team-off"}">
      <span class="pp-team-name">${escapeHtml(t.name)}${t.active ? "" : ` <span class="pp-tag">inactive</span>`}</span>
      <span class="pp-team-actions">
        <button class="pp-mini" data-team-toggle="${t.id}" data-active="${t.active ? 1 : 0}">${t.active ? "Deactivate" : "Activate"}</button>
        <button class="pp-mini pp-danger" data-team-del="${t.id}" title="Delete team (only if it has no deals)">✕</button>
      </span>
    </div>`;
  }

  function wire($view, user, teams) {
    const $form = $view.querySelector("#entry-form");
    if ($form) {
      const $value = $form.querySelector('[name="value_rand"]');
      const $type = $form.querySelector('[name="deal_type"]');
      const $pts = $view.querySelector("#entry-pts");
      const $bracket = $view.querySelector("#entry-bracket");

      const preview = () => {
        const raw = ($value.value || "").replace(/[^\d]/g, "");
        const v = raw ? Number(raw) : 0;
        const pts = POINTS.points($type.value, v);
        $pts.textContent = pts;
        $bracket.textContent = raw ? `· ${POINTS.bracketLabel(v)}` : "";
      };
      $value.addEventListener("input", () => {
        const raw = ($value.value || "").replace(/[^\d]/g, "");
        $value.value = raw ? Number(raw).toLocaleString("en-ZA").replace(/,/g, " ") : "";
        preview();
      });
      $type.addEventListener("change", preview);
      preview();

      $form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const $submit = $view.querySelector("#entry-submit");
        const fd = new FormData($form);
        const value = Number(String(fd.get("value_rand") || "").replace(/[^\d]/g, ""));
        if (!fd.get("team_id") || !value) { window.toast({ title: "Team and value are required", ms: 3000 }); return; }
        $submit.disabled = true; $submit.textContent = "Saving…";
        try {
          await DATA.addEntry({
            team_id: Number(fd.get("team_id")),
            deal_type: fd.get("deal_type"),
            value_rand: value,
            signed_date: fd.get("signed_date") || null,
            agent_name: (fd.get("agent_name") || "").trim() || null,
            reference: (fd.get("reference") || "").trim() || null,
            notes: (fd.get("notes") || "").trim() || null,
            created_by: user.username,
            created_by_name: user.name,
          });
          window.toast({ title: "Deal added ✓", ms: 2500 });
          await rerender($view, user);
        } catch (err) {
          window.toast({ title: "Could not add deal", body: escapeHtml(err.message || String(err)), ms: 6000 });
          $submit.disabled = false; $submit.textContent = "Add deal";
        }
      });
    }

    // Delegated actions for entries + teams.
    $view.addEventListener("click", async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;

      if (btn.dataset.verify) {
        await guard(btn, () => DATA.verifyEntry(btn.dataset.verify, user), $view, user, "Deal verified");
        return;
      }
      if (btn.dataset.reject) {
        const reason = window.prompt("Reject this submission. Reason (optional):", "");
        if (reason === null) return;
        await guard(btn, () => DATA.rejectEntry(btn.dataset.reject, reason, user), $view, user, "Submission rejected");
        return;
      }
      if (btn.dataset.void) {
        const willVoid = btn.dataset.cur === "0";
        let reason = null;
        if (willVoid) {
          reason = window.prompt("Void this deal (points removed). Reason (optional):", "Fell through");
          if (reason === null) return; // cancelled
        }
        await guard(btn, () => DATA.setEntryVoided(btn.dataset.void, willVoid, reason), $view, user,
          willVoid ? "Deal voided" : "Deal restored");
        return;
      }
      if (btn.dataset.del) {
        if (!window.confirm("Delete this deal permanently? This cannot be undone.")) return;
        await guard(btn, () => DATA.deleteEntry(btn.dataset.del), $view, user, "Deal deleted");
        return;
      }
      if (btn.dataset.teamToggle) {
        const active = btn.dataset.active === "0";
        await guard(btn, () => DATA.updateTeam(Number(btn.dataset.teamToggle), { active }), $view, user,
          active ? "Team activated" : "Team deactivated");
        return;
      }
      if (btn.dataset.teamDel) {
        if (!window.confirm("Delete this team? Only works if it has no deals logged.")) return;
        try {
          await DATA.deleteTeam(Number(btn.dataset.teamDel));
          window.toast({ title: "Team deleted", ms: 2500 });
          await rerender($view, user);
        } catch (err) {
          window.toast({ title: "Could not delete team", body: "It probably has deals logged - deactivate it instead.", ms: 5000 });
        }
        return;
      }
    });

    const $teamForm = $view.querySelector("#team-form");
    if ($teamForm) {
      $teamForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = ($teamForm.querySelector('[name="name"]').value || "").trim();
        if (!name) return;
        try {
          await DATA.addTeam(name);
          window.toast({ title: "Team added ✓", ms: 2500 });
          await rerender($view, user);
        } catch (err) {
          window.toast({ title: "Could not add team", body: escapeHtml(err.message || String(err)), ms: 5000 });
        }
      });
    }
  }

  async function guard(btn, fn, $view, user, okMsg) {
    btn.disabled = true;
    try {
      await fn();
      window.toast({ title: okMsg + " ✓", ms: 2500 });
      await rerender($view, user);
    } catch (err) {
      window.toast({ title: "Action failed", body: escapeHtml(err.message || String(err)), ms: 5000 });
      btn.disabled = false;
    }
  }

  window.VIEWS = window.VIEWS || {};
  window.VIEWS["admin"] = render;
})();
