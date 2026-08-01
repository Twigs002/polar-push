// Submit a deal - any broker logs a mandate / sale for their team.
// Submissions land as 'pending' and only count once an admin verifies them.
(function () {
  const { escapeHtml, escapeAttr } = UTILS;

  function money(v) { return "R" + (Number(v) || 0).toLocaleString("en-ZA"); }
  function fmtDate(s) {
    if (!s) return "";
    const d = new Date(s);
    return isNaN(d) ? "" : d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  }
  const STATUS = {
    pending:  { label: "Pending", cls: "pp-st-pending" },
    verified: { label: "Verified", cls: "pp-st-verified" },
    rejected: { label: "Rejected", cls: "pp-st-rejected" },
  };

  async function rerender($view, user) {
    const cache = await DATA.loadAll(true);
    render($view, { cache, user });
  }

  function render($view, ctx) {
    const { cache, user } = ctx;

    if (!cache.ready) {
      $view.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🛠️</div>
        <p>Polar Push isn't set up in Supabase yet. Ask an admin to run the migration.</p></div>`;
      return;
    }

    const teams = [...cache.teams].filter(t => t.active)
      .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
    // Prefill the team whose name matches the broker's division, if any.
    const mine = (user.division || "").toLowerCase();
    const defaultTeam = teams.find(t => t.name.toLowerCase() === mine);

    // Entries are RLS-scoped to the user's team(s), so this is the team's
    // submissions (admins see everything).
    const mySubs = (cache.entries || []).slice(0, 200);

    $view.innerHTML = `
      <div class="pp-submit">
        <div class="pp-card pp-entry-card">
          <h2>Submit a mandate</h2>
          <p class="muted">Log your signed mandate and attach the document. It goes to front office and only earns points once an admin verifies it. (Sales / OTPs are tracked separately.)</p>
          ${teams.length ? "" : `<p class="pp-warn">No teams are set up yet - ask an admin.</p>`}
          <form id="submit-form" class="pp-form" ${teams.length ? "" : "hidden"}>
            <div class="pp-form-grid">
              <label>Team
                <select name="team_id" required>
                  <option value="">Select team…</option>
                  ${teams.map(t => `<option value="${t.id}" ${defaultTeam && defaultTeam.id === t.id ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}
                </select>
              </label>
              <label>Mandate type
                <select name="deal_type" required>
                  ${POINTS.MANDATE_TYPES.map(t => `<option value="${t.key}">${escapeHtml(t.label)}</option>`).join("")}
                </select>
              </label>
              <label>Value (R)
                <input name="value_rand" type="text" inputmode="numeric" placeholder="e.g. 12 500 000" required>
              </label>
              <label>Signed date
                <input name="signed_date" type="date">
              </label>
              <label class="pp-span-2">Property address <span class="pp-req">required</span>
                <input name="property_address" type="text" placeholder="e.g. 12 Beach Road, Sea Point" required>
              </label>
            </div>
            <label class="pp-file-label">Signed mandate document <span class="pp-req">required</span>
              <input name="doc" type="file" accept="application/pdf,image/*" required>
              <span class="pp-file-hint">PDF or a clear photo of the fully signed mandate.</span>
            </label>
            <div class="pp-form-foot">
              <div class="pp-preview">Worth <strong id="sub-pts">0</strong> points once verified <span id="sub-bracket" class="muted"></span></div>
              <button type="submit" class="btn-primary" id="sub-submit">Submit for verification</button>
            </div>
          </form>
        </div>

        <div class="pp-card" ${user && user.username ? "" : "hidden"}>
          <div class="pp-card-head">
            <h2>Team submissions</h2>
            <span class="muted small">${mySubs.length ? `${mySubs.length} shown` : ""}</span>
          </div>
          ${mySubs.length ? mySubsTable(mySubs, cache.teams) : `<p class="muted">No submissions for your team yet. Your team's mandates show here with their status.</p>`}
        </div>
      </div>`;

    wire($view, user);
  }

  function mySubsTable(subs, teams) {
    const teamName = id => (teams.find(t => t.id === id) || {}).name || "-";
    return `<div class="pp-table-wrap">
      <table class="pp-entries">
        <thead><tr>
          <th>Team</th><th>By</th><th>Type</th><th class="num">Value</th><th class="num">Pts</th>
          <th>Signed</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${subs.map(e => {
            const st = STATUS[e.status] || STATUS.pending;
            const note = e.status === "rejected" && e.reject_reason ? `<div class="pp-sub-note">${escapeHtml(e.reject_reason)}</div>`
              : e.voided ? `<div class="pp-sub-note">Voided - deal fell through</div>` : "";
            return `<tr class="${e.voided ? "pp-voided" : ""}">
              <td>${escapeHtml(teamName(e.team_id))}</td>
              <td>${escapeHtml(e.submitted_by_name || e.agent_name || "")}</td>
              <td>${escapeHtml(POINTS.typeLabel(e.deal_type))}</td>
              <td class="num">${money(e.value_rand)}</td>
              <td class="num"><strong>${(e.status === "verified" && !e.voided) ? e.points : "-"}</strong></td>
              <td>${escapeHtml(fmtDate(e.signed_date))}</td>
              <td><span class="pp-status ${st.cls}">${st.label}</span>${note}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
  }

  function wire($view, user) {
    const $form = $view.querySelector("#submit-form");
    if (!$form) return;
    const $value = $form.querySelector('[name="value_rand"]');
    const $type = $form.querySelector('[name="deal_type"]');
    const $pts = $view.querySelector("#sub-pts");
    const $bracket = $view.querySelector("#sub-bracket");

    const preview = () => {
      const raw = ($value.value || "").replace(/[^\d]/g, "");
      const v = raw ? Number(raw) : 0;
      $pts.textContent = POINTS.points($type.value, v);
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
      const $btn = $view.querySelector("#sub-submit");
      const fd = new FormData($form);
      const value = Number(String(fd.get("value_rand") || "").replace(/[^\d]/g, ""));
      const address = (fd.get("property_address") || "").trim();
      const submitter = (user && user.name) || null;   // from the logged-in user
      const file = ($form.querySelector('[name="doc"]').files || [])[0];
      if (!fd.get("team_id") || !value) { window.toast({ title: "Team and value are required", ms: 3000 }); return; }
      if (!address) { window.toast({ title: "Property address is required", ms: 3000 }); return; }
      if (!file) { window.toast({ title: "Attach the signed mandate document", ms: 3500 }); return; }
      if (file.size > 15 * 1024 * 1024) { window.toast({ title: "File too large", body: "Please keep it under 15 MB.", ms: 4000 }); return; }
      $btn.disabled = true; $btn.textContent = "Uploading…";
      try {
        const doc = await DATA.uploadMandateDoc(file, user);
        // Human label for the file (used in the app + when it lands in Drive).
        const teamName = ($form.querySelector('[name="team_id"] option:checked') || {}).textContent || "";
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        const label = `${teamName.trim()} - ${address} (${POINTS.typeLabel(fd.get("deal_type"))})${ext ? "." + ext : ""}`;
        $btn.textContent = "Submitting…";
        await DATA.submitEntry({
          team_id: Number(fd.get("team_id")),
          deal_type: fd.get("deal_type"),
          value_rand: value,
          signed_date: fd.get("signed_date") || null,
          property_address: address,
          document_path: doc.path,
          document_name: label,
          agent_name: submitter,
          submitted_by: (user && user.username) || null,
          submitted_by_name: submitter,
          created_by: (user && user.username) || null,
          created_by_name: submitter,
        });
        window.toast({ title: "Submitted for verification ✓", body: "Front office will review the mandate soon.", ms: 4000 });
        await rerender($view, user);
      } catch (err) {
        window.toast({ title: "Could not submit", body: escapeHtml(err.message || String(err)), ms: 6000 });
        $btn.disabled = false; $btn.textContent = "Submit for verification";
      }
    });
  }

  window.VIEWS = window.VIEWS || {};
  window.VIEWS["submit"] = render;
})();
