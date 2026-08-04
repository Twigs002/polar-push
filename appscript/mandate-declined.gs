/**
 * Operation Polar Push - "mandate declined" mailer (Gmail / Apps Script).
 * Same pattern as the other Quay dashboards: a Web App that sends via Gmail.
 *
 * DEPLOY:
 *   1. script.google.com -> New project -> paste this file.
 *   2. Project Settings -> Script properties, add:
 *        SUPABASE_URL          https://dqszbqiimbfvmmnpgpsb.supabase.co
 *        SUPABASE_SERVICE_KEY  <service-role key from Supabase -> Settings -> API>
 *      (optional) MANDATE_CC   sheldon@quay1.co.za,diego@quay1.co.za
 *      (optional) MANDATE_FROM_NAME  Polar Push
 *   3. Deploy -> New deployment -> Web app.
 *        Execute as: Me.   Who has access: Anyone.
 *   4. Copy the Web app URL and send it to me; I wire it into the site.
 *
 * The site (data.js) POSTs { "entryId": "<uuid>" } after an admin rejects a
 * mandate. This looks the entry up server-side with the service key, confirms
 * it is genuinely rejected, and emails the submitter (CC Sheldon + Diego).
 * Nothing is emailed unless a real rejected entry exists, so the public URL
 * can't be used to fake decline notices.
 */
var TYPE_LABEL = {
  sole: "Sole mandate", dual: "Dual mandate", open: "Signed open mandate",
  otp: "Sale (OTP)", lease: "Lease"
};

// A stray GET (someone opening the /exec URL, a redirect-follow) should not
// error the execution log - just say the endpoint is alive.
function doGet(e) {
  return _json({ ok: true, service: "polar-push mandate-declined mailer" });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var id = body.entryId;
    if (!id) return _json({ error: "no entryId" });

    var p = PropertiesService.getScriptProperties();
    var SB = p.getProperty("SUPABASE_URL");
    var KEY = p.getProperty("SUPABASE_SERVICE_KEY");
    var CC = p.getProperty("MANDATE_CC") || "sheldon@quay1.co.za,diego@quay1.co.za";
    var FROM_NAME = p.getProperty("MANDATE_FROM_NAME") || "Polar Push";

    var entry = _sb(SB, KEY, "polar_push_entries", "id=eq." + encodeURIComponent(id) + "&select=*")[0];
    if (!entry) return _json({ skipped: "entry not found" });
    if (entry.status !== "rejected" || entry.voided) return _json({ skipped: "not a live rejection" });

    var username = entry.submitted_by || entry.created_by;
    var staff = username ? _sb(SB, KEY, "staff", "id=eq." + encodeURIComponent(username) + "&select=name,email")[0] : null;
    var team = entry.team_id ? _sb(SB, KEY, "polar_push_teams", "id=eq." + entry.team_id + "&select=name")[0] : null;

    var to = (staff && staff.email && staff.email.indexOf("@") > -1) ? staff.email
           : (username ? username + "@quay1.co.za" : null);
    if (!to) return _json({ skipped: "no recipient email" });

    var html = _html({
      name: (staff && staff.name) || entry.submitted_by_name || "",
      team: (team && team.name) || "your team",
      type: TYPE_LABEL[entry.deal_type] || entry.deal_type || "Mandate",
      value: "R" + Number(entry.value_rand || 0).toLocaleString("en-ZA"),
      address: entry.property_address || "",
      reason: entry.reject_reason || "Not specified"
    });

    GmailApp.sendEmail(
      to,
      "Your Polar Push mandate needs attention",
      "Your mandate was declined. Reason: " + (entry.reject_reason || "Not specified"),
      { htmlBody: html, cc: CC, name: FROM_NAME }
    );
    return _json({ sent: to });
  } catch (err) {
    return _json({ error: String(err) });
  }
}

function _sb(url, key, table, query) {
  var res = UrlFetchApp.fetch(url + "/rest/v1/" + table + "?" + query, {
    method: "get",
    headers: { apikey: key, Authorization: "Bearer " + key },
    muteHttpExceptions: true
  });
  try { return JSON.parse(res.getContentText()) || []; } catch (e) { return []; }
}

function _json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function _html(o) {
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  };
  return '' +
  '<div style="margin:0;background:#f4f6fb;font-family:Segoe UI,Arial,sans-serif;color:#1f2937;padding:24px 0">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
      '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.08)">' +
        '<tr><td style="background:#3D5BA6;padding:20px 28px">' +
          '<div style="color:#fff;font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">Operation Polar Push</div>' +
          '<div style="color:#FDC503;font-size:22px;font-weight:800;margin-top:2px">Mandate needs attention</div>' +
        '</td></tr>' +
        '<tr><td style="padding:28px">' +
          '<p style="margin:0 0 14px">Hi ' + esc(o.name || "there") + ',</p>' +
          '<p style="margin:0 0 14px">Your submitted mandate has been <strong style="color:#D20A03">declined</strong> by front office and needs fixing before it can score. Please correct the issue below and re-submit.</p>' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;margin:6px 0 18px">' +
            '<tr><td style="padding:14px 16px;border-bottom:1px solid #f0f0f0">' +
              '<div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Reason for decline</div>' +
              '<div style="font-size:16px;font-weight:700;color:#D20A03;margin-top:3px">' + esc(o.reason) + '</div>' +
            '</td></tr>' +
            '<tr><td style="padding:14px 16px">' +
              '<div style="font-size:13px;color:#6b7280">' + esc(o.team) + ' &middot; ' + esc(o.type) + ' &middot; ' + esc(o.value) + '</div>' +
              '<div style="font-size:14px;margin-top:4px">' + esc(o.address) + '</div>' +
            '</td></tr>' +
          '</table>' +
          '<a href="https://twigs002.github.io/polar-push/#/submit" style="display:inline-block;background:#3D5BA6;color:#fff;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:9px">Re-submit the mandate</a>' +
          '<p style="margin:22px 0 0;font-size:12px;color:#6b7280">You are receiving this because you submitted this mandate on the Polar Push portal.</p>' +
        '</td></tr>' +
      '</table>' +
    '</td></tr></table>' +
  '</div>';
}
