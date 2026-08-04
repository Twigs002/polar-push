// Supabase data layer for Operation Polar Push.
// Auth mirrors quay-leads (clock-in username + PIN → staff row). Standings
// are readable by any active staff; entry writes are RLS-gated to super/admin.
window.DATA = (() => {
  let _client = null;
  let _cache = null;

  function client() {
    if (!_client) {
      _client = supabase.createClient(QUAY.SUPABASE_URL, QUAY.SUPABASE_ANON_KEY);
    }
    return _client;
  }

  function emailFor(username) {
    return `${(username || "").toLowerCase().trim()}@${QUAY.AUTH_EMAIL_DOMAIN}`;
  }

  function userFromStaff(staff, email) {
    return {
      username: staff.id, name: staff.name, email,
      division: staff.division,
      isSuper: !!staff.is_super, isAdmin: !!staff.is_admin,
      isEditor: !!staff.is_super || !!staff.is_admin,
    };
  }

  async function signIn(username, pin) {
    const sb = client();
    const { data, error } = await sb.auth.signInWithPassword({
      email: emailFor(username), password: pin,
    });
    if (error) return { ok: false, error: "Username or PIN not recognised." };
    if (!data.user) return { ok: false, error: "Login failed." };
    const { data: staff } = await sb.from("staff").select("*").eq("auth_user_id", data.user.id).maybeSingle();
    if (!staff) { await sb.auth.signOut(); return { ok: false, error: "No staff record." }; }
    if (staff.active === false) { await sb.auth.signOut(); return { ok: false, error: "Account is disabled." }; }
    return { ok: true, user: userFromStaff(staff, data.user.email) };
  }

  async function signOut() {
    await client().auth.signOut();
    _cache = null;
  }

  async function getSession() {
    const sb = client();
    const { data } = await sb.auth.getSession();
    if (!data.session) return null;
    const { data: staff } = await sb.from("staff").select("*").eq("auth_user_id", data.session.user.id).maybeSingle();
    if (!staff || staff.active === false) return null;
    return userFromStaff(staff, data.session.user.email);
  }

  // PostgREST caps at 1000 rows/request - page through everything.
  async function _allRows(table, order) {
    const sb = client();
    const PAGE = 1000;
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      let q = sb.from(table).select("*").range(from, from + PAGE - 1);
      if (order) q = q.order(order.col, { ascending: order.asc !== false });
      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    return rows;
  }

  function _missingTable(err) {
    if (!err) return false;
    if ((err.code || "") === "42P01" || (err.code || "") === "PGRST205") return true;
    return /does not exist|schema cache|could not find the table/i.test(err.message || "");
  }

  async function loadAll(force = false) {
    if (_cache && !force) return _cache;
    try {
      const [teams, entries] = await Promise.all([
        _allRows("polar_push_teams", { col: "sort_order" }),
        _allRows("polar_push_entries", { col: "created_at", asc: false }),
      ]);
      _cache = { ready: true, teams, entries };
    } catch (e) {
      if (_missingTable(e)) { _cache = { ready: false, teams: [], entries: [] }; }
      else throw e;
    }
    return _cache;
  }

  // Any entry/team mutation can shift the aggregate standings, so drop that
  // cache too - otherwise the leaderboard keeps serving the login snapshot.
  function invalidate() { _cache = null; _standings = null; }
  function invalidateStandings() { _standings = null; }

  // Public aggregate standings (the leaderboard reads this; anon-readable via
  // a grant on the view, so no PIN is needed to watch the scoreboard).
  let _standings = null;
  async function loadStandings(force = false) {
    if (_standings && !force) return _standings;
    try {
      const rows = await _allRows("polar_push_standings", { col: "total_points", asc: false });
      _standings = { ready: true, standings: rows, at: new Date() };
    } catch (e) {
      if (_missingTable(e)) { _standings = { ready: false, standings: [], at: new Date() }; }
      else throw e;
    }
    return _standings;
  }

  // Public OTP list (team, acceptance date, amount, points) for the OTP
  // tracking view. Anon-readable via a grant on the view.
  let _otps = null;
  async function loadOtps(force = false) {
    if (_otps && !force) return _otps;
    try {
      const rows = await _allRows("polar_push_otps_public", { col: "acceptance_date", asc: false });
      _otps = { ready: true, otps: rows, at: new Date() };
    } catch (e) {
      if (_missingTable(e)) { _otps = { ready: false, otps: [], at: new Date() }; }
      else throw e;
    }
    return _otps;
  }
  function invalidateOtps() { _otps = null; }

  // ── Mandate document upload / retrieval (Supabase Storage) ──────────────
  const MANDATE_BUCKET = "polar-mandates";

  async function uploadMandateDoc(file, user) {
    if (!file) throw new Error("No file selected");
    const ext = (file.name.split(".").pop() || "dat").toLowerCase().replace(/[^a-z0-9]/g, "");
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const path = `${(user && user.username) || "anon"}/${stamp}.${ext}`;
    const { data, error } = await client().storage
      .from(MANDATE_BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (error) throw error;
    return { path: data.path, name: file.name };
  }

  // Short-lived signed URL so an admin can open the document to verify it.
  async function mandateDocUrl(path) {
    if (!path) return null;
    const { data, error } = await client().storage
      .from(MANDATE_BUCKET)
      .createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }

  // ── Broker submission (any active staff; lands as 'pending') ────────────
  async function submitEntry(entry) {
    const { points, ...rest } = entry;
    const clean = { ...rest, status: "pending", voided: false };
    const { error } = await client().from("polar_push_entries").insert(clean);
    if (error) throw error;
    invalidate();
  }

  // ── Admin mutations (super/admin only; RLS enforces server-side) ────────
  async function addEntry(entry) {
    // points is a GENERATED column - never sent from the client.
    // Admin direct-adds are verified immediately.
    const { points, ...rest } = entry;
    const { error } = await client().from("polar_push_entries")
      .insert({ ...rest, status: "verified" });
    if (error) throw error;
    invalidate();
  }

  async function verifyEntry(id, user) {
    const { error } = await client().from("polar_push_entries").update({
      status: "verified", reject_reason: null,
      verified_by: user.username, verified_by_name: user.name,
      verified_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) throw error;
    invalidate();
  }

  async function rejectEntry(id, reason, user) {
    const { error } = await client().from("polar_push_entries").update({
      status: "rejected", reject_reason: reason || null,
      verified_by: user.username, verified_by_name: user.name,
      verified_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) throw error;
    invalidate();
    notifyDecline(id);
  }

  // Fire-and-forget: ask the Gmail Apps Script web app to email the submitter.
  // Never block or fail the rejection on the email (the reject already stuck).
  function notifyDecline(id) {
    const url = (window.QUAY && QUAY.DECLINE_MAIL_URL) || "";
    if (!url) return;
    try {
      // text/plain keeps this a "simple" request so the browser skips the CORS
      // preflight - Apps Script has no OPTIONS handler and would otherwise fall
      // through to a (missing) doGet and never run doPost. no-cors because this
      // is fire-and-forget: we don't need to read the response.
      fetch(url, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ entryId: id }),
      }).catch(() => {});
    } catch (e) { /* ignore - notification is best-effort */ }
  }

  async function updateEntry(id, patch) {
    const { points, ...clean } = patch;
    const { error } = await client().from("polar_push_entries").update(clean).eq("id", id);
    if (error) throw error;
    invalidate();
  }

  async function setEntryVoided(id, voided, reason) {
    const { error } = await client().from("polar_push_entries")
      .update({ voided: !!voided, void_reason: voided ? (reason || null) : null })
      .eq("id", id);
    if (error) throw error;
    invalidate();
  }

  async function deleteEntry(id) {
    const { error } = await client().from("polar_push_entries").delete().eq("id", id);
    if (error) throw error;
    invalidate();
  }

  async function addTeam(name) {
    const { error } = await client().from("polar_push_teams")
      .insert({ name: (name || "").trim() });
    if (error) throw error;
    invalidate();
  }

  async function updateTeam(id, patch) {
    const { error } = await client().from("polar_push_teams").update(patch).eq("id", id);
    if (error) throw error;
    invalidate();
  }

  async function deleteTeam(id) {
    const { error } = await client().from("polar_push_teams").delete().eq("id", id);
    if (error) throw error;
    invalidate();
  }

  return {
    client, signIn, signOut, getSession, loadAll, invalidate,
    loadStandings, invalidateStandings, loadOtps, invalidateOtps,
    uploadMandateDoc, mandateDocUrl,
    submitEntry, addEntry, verifyEntry, rejectEntry,
    updateEntry, setEntryVoided, deleteEntry,
    addTeam, updateTeam, deleteTeam,
  };
})();
