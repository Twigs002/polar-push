// Operation Polar Push - email the submitter when their mandate is declined.
//
// Wiring: a Supabase Database Webhook on public.polar_push_entries (UPDATE)
// calls this function. It only emails when the row has just transitioned INTO
// status='rejected' (so verify/void/edit updates don't trigger it), sending the
// broker who submitted the mandate the exact decline reason Diego picked.
//
// Required secrets (supabase secrets set ...):
//   RESEND_API_KEY        Resend API key
//   MANDATE_FROM_EMAIL    e.g. "Quay 1 Polar Push <polar-push@quay1.co.za>"
// Optional:
//   MANDATE_CC            comma-separated CC list; defaults to Sheldon + Diego.
// Provided automatically to Edge Functions:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// The email domain in MANDATE_FROM_EMAIL must be a verified sending domain in
// Resend. Real submitter address comes from staff.email, falling back to
// <username>@quay1.co.za.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FALLBACK_EMAIL_DOMAIN = "quay1.co.za";
const DEFAULT_CC = "sheldon@quay1.co.za,diego@quay1.co.za";

const BRAND = {
  blue: "#3D5BA6",
  yellow: "#FDC503",
  lightBlue: "#98C5ED",
  red: "#D20A03",
  ink: "#1f2937",
  muted: "#6b7280",
};

const TYPE_LABEL: Record<string, string> = {
  sole: "Sole mandate",
  dual: "Dual mandate",
  open: "Signed open mandate",
  otp: "Sale (OTP)",
  lease: "Lease",
};

function money(v: unknown): string {
  const n = Number(v);
  return "R" + (Number.isFinite(n) ? n : 0).toLocaleString("en-ZA");
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

function emailBody(opts: {
  name: string; team: string; type: string; value: string;
  address: string; reason: string;
}): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Segoe UI,Arial,sans-serif;color:${BRAND.ink}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.08)">
        <tr><td style="background:${BRAND.blue};padding:20px 28px">
          <div style="color:#fff;font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">Operation Polar Push</div>
          <div style="color:${BRAND.yellow};font-size:22px;font-weight:800;margin-top:2px">Mandate needs attention</div>
        </td></tr>
        <tr><td style="padding:28px">
          <p style="margin:0 0 14px">Hi ${esc(opts.name || "there")},</p>
          <p style="margin:0 0 14px">Your submitted mandate has been <strong style="color:${BRAND.red}">declined</strong> by front office and needs fixing before it can score. Please correct the issue below and re-submit.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;margin:6px 0 18px">
            <tr><td style="padding:14px 16px;border-bottom:1px solid #f0f0f0">
              <div style="font-size:12px;color:${BRAND.muted};text-transform:uppercase;letter-spacing:.04em">Reason for decline</div>
              <div style="font-size:16px;font-weight:700;color:${BRAND.red};margin-top:3px">${esc(opts.reason || "Not specified")}</div>
            </td></tr>
            <tr><td style="padding:14px 16px">
              <div style="font-size:13px;color:${BRAND.muted}">${esc(opts.team)} &middot; ${esc(opts.type)} &middot; ${esc(opts.value)}</div>
              <div style="font-size:14px;margin-top:4px">${esc(opts.address)}</div>
            </td></tr>
          </table>
          <a href="https://twigs002.github.io/polar-push/#/submit" style="display:inline-block;background:${BRAND.blue};color:#fff;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:9px">Re-submit the mandate</a>
          <p style="margin:22px 0 0;font-size:12px;color:${BRAND.muted}">You're getting this because you submitted this mandate on the Polar Push portal.</p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const rec = payload?.record ?? {};
    const old = payload?.old_record ?? {};

    // Only fire on a fresh transition INTO rejected.
    if (rec.status !== "rejected" || old.status === "rejected") {
      return new Response(JSON.stringify({ skipped: "not a new rejection" }), {
        headers: { "content-type": "application/json" },
      });
    }
    const username = rec.submitted_by || rec.created_by;
    if (!username) {
      return new Response(JSON.stringify({ skipped: "no submitter on entry" }), {
        headers: { "content-type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: staff } = await supabase
      .from("staff").select("name,email").eq("id", username).maybeSingle();
    const { data: team } = await supabase
      .from("polar_push_teams").select("name").eq("id", rec.team_id).maybeSingle();

    const to = (staff?.email && String(staff.email).includes("@"))
      ? String(staff.email)
      : `${username}@${FALLBACK_EMAIL_DOMAIN}`;

    const cc = (Deno.env.get("MANDATE_CC") ?? DEFAULT_CC)
      .split(",").map((s) => s.trim()).filter((s) => s.includes("@") && s !== to);

    const html = emailBody({
      name: staff?.name || rec.submitted_by_name || "",
      team: team?.name || "your team",
      type: TYPE_LABEL[rec.deal_type] || rec.deal_type || "Mandate",
      value: money(rec.value_rand),
      address: rec.property_address || "",
      reason: rec.reject_reason || "",
    });

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: Deno.env.get("MANDATE_FROM_EMAIL") || "Polar Push <polar-push@quay1.co.za>",
        to: [to],
        cc,
        subject: "Your Polar Push mandate needs attention",
        html,
      }),
    });

    const result = await resp.json();
    if (!resp.ok) {
      console.error("Resend send failed:", result);
      return new Response(JSON.stringify({ error: result }), {
        status: 502, headers: { "content-type": "application/json" },
      });
    }
    console.log(`Declined-mandate email sent to ${to} (entry ${rec.id})`);
    return new Response(JSON.stringify({ sent: to, id: result?.id }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("mandate-declined error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
});
