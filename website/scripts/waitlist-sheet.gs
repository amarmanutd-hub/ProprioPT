/**
 * Proprio waitlist → Google Sheet + email notification (your Google account).
 *
 * ONE-TIME SETUP
 * 1. Create a Google Sheet (any name).
 * 2. Extensions → Apps Script → delete the stub → paste this entire file.
 * 3. Confirm NOTIFY_TO is your inbox (below).
 * 4. Deploy → New deployment → Web app
 *      Execute as: Me
 *      Who has access: Anyone
 * 5. Copy the Web app URL.
 * 6. Vercel → Project proprio → Settings → Environment Variables
 *      Name:  WAITLIST_SCRIPT_URL
 *      Value: (paste the Web app URL)
 *      Environments: Production, Preview
 * 7. Redeploy the site.
 *
 * After that, Join waitlist stays on the website — row in Sheet + email to you.
 */

const NOTIFY_TO = "amarmalhi.me@icloud.com";
const SHEET_NAME = "Waitlist";

function doPost(e) {
  try {
    const raw = e.postData && e.postData.contents ? e.postData.contents : "{}";
    const data = JSON.parse(raw);
    const name = String(data.name || "").trim();
    const email = String(data.email || "").trim();
    const role = String(data.role || "").trim();
    const note = String(data.note || "").trim();

    if (!name || !email || !role) {
      return json_({ ok: false, error: "missing_fields" });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(["Timestamp", "Name", "Email", "Role", "Note"]);
    }

    sheet.appendRow([new Date(), name, email, role, note]);

    MailApp.sendEmail({
      to: NOTIFY_TO,
      subject: `Proprio waitlist — ${name} (${role})`,
      body:
        `New waitlist signup\n\n` +
        `Name: ${name}\n` +
        `Email: ${email}\n` +
        `Role: ${role}\n` +
        `Note: ${note || "—"}\n`,
    });

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json_({ ok: true, service: "proprio-waitlist" });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
