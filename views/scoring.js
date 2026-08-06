// How scoring works - rules table + a live calculator. Readable by all staff.
(function () {
  const { escapeHtml } = UTILS;

  const BRACKETS = [
    { label: "Under R5m", mult: 1 },
    { label: "R5m - R10m", mult: 2 },
    { label: "R10m - R15m", mult: 3 },
    { label: "R15m+", mult: 4, note: "+1 bracket every extra R5m" },
  ];

  function pointsCell(base, mult) {
    return `<strong>${base * mult}</strong>`;
  }

  function render($view) {
    $view.innerHTML = `
      <div class="pp-scoring">
        <div class="pp-card">
          <h2>How points are earned</h2>
          <p class="muted">Points step up one full bracket for every <strong>R5 million</strong> of deal value.
            Rentals (leases) bracket on <strong>double</strong> their rand value, so a R3m rental is scored as if it were R6m.
            A mandate or sale only counts once it's been submitted to front office and properly signed -
            missing signatures, initials or dates mean it won't be verified. Deals that later fall through have their points deducted.</p>

          <div class="pp-table-wrap">
            <table class="pp-rules">
              <thead>
                <tr>
                  <th>Deal type</th>
                  ${BRACKETS.map(b => `<th>${escapeHtml(b.label)}${b.note ? `<span class="th-note">${escapeHtml(b.note)}</span>` : ""}</th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${POINTS.TYPES.map(t => `
                  <tr>
                    <td class="pp-rules-type">${escapeHtml(t.label)}<span class="pp-rules-base">${t.base} pt / bracket${t.valueMult > 1 ? " · value counts double" : ""}</span></td>
                    ${BRACKETS.map(b => `<td>${pointsCell(t.base, b.mult)}</td>`).join("")}
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
          <p class="muted small">Sales OTPs and leases only count when signed by all parties, with FICA documentation and the property condition report in place.</p>
        </div>

        <div class="pp-card pp-calc">
          <h2>Points calculator</h2>
          <div class="pp-calc-controls">
            <label>Deal type
              <select id="calc-type">
                ${POINTS.TYPES.map(t => `<option value="${t.key}">${escapeHtml(t.label)}</option>`).join("")}
              </select>
            </label>
            <label>Value (R)
              <input id="calc-value" type="text" inputmode="numeric" placeholder="e.g. 12 500 000">
            </label>
          </div>
          <div class="pp-calc-out">
            <div class="pp-calc-pts"><span id="calc-pts">0</span><span class="pp-calc-unit">points</span></div>
            <div class="pp-calc-detail" id="calc-detail">Enter a value to see the score.</div>
          </div>
        </div>
      </div>`;

    const $type = document.getElementById("calc-type");
    const $value = document.getElementById("calc-value");
    const $pts = document.getElementById("calc-pts");
    const $detail = document.getElementById("calc-detail");

    function recompute() {
      const raw = ($value.value || "").replace(/[^\d.]/g, "");
      const v = raw ? Number(raw) : 0;
      const type = $type.value;
      const pts = POINTS.points(type, v);
      $pts.textContent = pts;
      if (!raw) { $detail.textContent = "Enter a value to see the score."; return; }
      // Leases bracket on double their value - label the bracket the points
      // were actually worked out from, so the detail line can't contradict them.
      const mult = (POINTS.BY_KEY[type] || {}).valueMult || 1;
      const bracketText = POINTS.bracketLabel(v * mult) + (mult > 1 ? " · counts double" : "");
      $detail.innerHTML = `${escapeHtml(POINTS.typeLabel(type))} · ${escapeHtml(bracketText)} → <strong>${pts} points</strong>`;
    }

    // Live thousands-grouping while typing.
    $value.addEventListener("input", () => {
      const raw = ($value.value || "").replace(/[^\d]/g, "");
      $value.value = raw ? Number(raw).toLocaleString("en-ZA").replace(/,/g, " ") : "";
      recompute();
    });
    $type.addEventListener("change", recompute);
    recompute();
  }

  window.VIEWS = window.VIEWS || {};
  window.VIEWS["scoring"] = render;
})();
