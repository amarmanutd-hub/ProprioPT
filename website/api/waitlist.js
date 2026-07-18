/**
 * POST /api/waitlist
 * Same-origin endpoint — browser never opens mail or a third-party form host.
 * Forwards to your Google Apps Script (Sheet row + email notification).
 *
 * Set on Vercel (Project → Settings → Environment Variables):
 *   WAITLIST_SCRIPT_URL = https://script.google.com/macros/s/.../exec
 *
 * Script source: website/scripts/waitlist-sheet.gs
 */

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const scriptUrl = process.env.WAITLIST_SCRIPT_URL;
  if (!scriptUrl) {
    res.status(503).json({
      ok: false,
      error: "not_configured",
      hint: "Set WAITLIST_SCRIPT_URL to your Apps Script web app URL",
    });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ ok: false, error: "invalid_json" });
      return;
    }
  }
  if (!body || typeof body !== "object") {
    res.status(400).json({ ok: false, error: "invalid_body" });
    return;
  }

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const role = String(body.role || "").trim();
  const note = String(body.note || "").trim();

  if (!name || !email || !role) {
    res.status(400).json({ ok: false, error: "missing_fields" });
    return;
  }

  try {
    const upstream = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ name, email, role, note }),
      redirect: "follow",
    });

    // Apps Script often returns 200 after redirects even when ok.
    if (!upstream.ok) {
      res.status(502).json({ ok: false, error: "upstream_failed" });
      return;
    }

    res.status(200).json({ ok: true });
  } catch {
    res.status(502).json({ ok: false, error: "upstream_error" });
  }
};
