// Shared utilities - used across views.
window.UTILS = (() => {
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  function trunc(s, n) {
    return s && s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function fmtDate(s) {
    if (!s) return "";
    const d = new Date(s);
    return isNaN(d) ? "" : d.toISOString().slice(0, 16).replace("T", " ");
  }

  function fmtShortDate(s) {
    if (!s) return "";
    const d = new Date(s);
    return isNaN(d) ? "" : d.toISOString().slice(0, 10);
  }

  function humanAgo(date) {
    let s = (Date.now() - date.getTime()) / 1000;
    // Future dates (e.g. a lead whose sheet date was mis-parsed day/month)
    // must not render as a negative "-123s ago".
    const future = s < 0;
    s = Math.abs(s);
    const unit = s < 60 ? `${Math.floor(s)}s`
      : s < 3600 ? `${Math.floor(s / 60)} min`
      : s < 86400 ? `${Math.floor(s / 3600)} h`
      : `${Math.floor(s / 86400)} d`;
    return future ? `in ${unit}` : `${unit} ago`;
  }

  function pct(n, d) { return d ? `${(n / d * 100).toFixed(1)}%` : "-"; }

  // Digit string of a rand value's WHOLE part. Drops a trailing cents group
  // written with either separator (".50" or ",00"), then keeps digits only, so
  // "R12 500 000.50" and "5 000 000,00" both yield the whole rand amount rather
  // than the old "1250000050" (dot stripped and the cents concatenated, ~100x).
  // A 3+ digit trailing group is a thousands group, not cents, so it's kept.
  function randDigits(s) {
    return String(s == null ? "" : s).trim().replace(/[.,]\d{1,2}$/, "").replace(/\D/g, "");
  }

  // Empty-state HTML when filters return zero rows
  function emptyState(message = "No leads match the current filters.") {
    return `<div class="empty-state">
      <div class="empty-state-icon">∅</div>
      <p>${escapeHtml(message)}</p>
      <button class="btn-ghost" onclick="document.getElementById('f-reset').click()">Reset filters</button>
    </div>`;
  }

  return { escapeHtml, escapeAttr, trunc, fmtDate, fmtShortDate, humanAgo, pct, randDigits, emptyState };
})();
