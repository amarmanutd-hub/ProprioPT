/**
 * Multi-exercise pack export — HTML + JSON download (local only).
 */

import type { PackExerciseRow } from "../pack/types";

export interface PackSessionPayload {
  packId: string;
  startedAt: string;
  endedAt: string;
  exercises: PackExerciseRow[];
}

export class PackSessionExport {
  static build(input: {
    packId: string;
    startedAt: string;
    exercises: PackExerciseRow[];
  }): PackSessionPayload {
    return {
      packId: input.packId,
      startedAt: input.startedAt,
      endedAt: new Date().toISOString(),
      exercises: input.exercises,
    };
  }

  static toHtml(payload: PackSessionPayload): string {
    const rows = payload.exercises
      .map((e) => {
        const mode =
          e.mode === "form" ? "Form coached" : "Counting only";
        const flags =
          e.formEvents.length === 0
            ? "—"
            : e.formEvents.map((f) => `${f.type}: ${f.count}`).join(", ");
        return `<tr>
  <td>${escapeHtml(e.title)}</td>
  <td>${escapeHtml(mode)}</td>
  <td>${escapeHtml(e.status)}</td>
  <td>${e.repsCounted}</td>
  <td>${escapeHtml(flags)}</td>
</tr>`;
      })
      .join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Proprio pack ${escapeHtml(payload.packId)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #111; }
  h1 { font-size: 1.25rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { border: 1px solid #ccc; padding: 0.5rem 0.65rem; text-align: left; font-size: 0.9rem; }
  th { background: #f4f4f4; }
  .meta { color: #555; font-size: 0.85rem; }
</style>
</head>
<body>
<h1>Proprio session summary</h1>
<p class="meta">Pack: ${escapeHtml(payload.packId)} · Started ${escapeHtml(payload.startedAt)} · Ended ${escapeHtml(payload.endedAt)}</p>
<p class="meta">Stayed on device — share this file with your PT if you choose.</p>
<table>
  <thead>
    <tr><th>Exercise</th><th>Mode</th><th>Status</th><th>Reps</th><th>Form notes</th></tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>
</body>
</html>`;
  }

  static downloadHtml(payload: PackSessionPayload, filename?: string): void {
    const html = PackSessionExport.toHtml(payload);
    const blob = new Blob([html], { type: "text/html" });
    triggerDownload(
      blob,
      filename ?? `proprio-${payload.packId}-${payload.endedAt.slice(0, 10)}.html`,
    );
  }

  static downloadJson(payload: PackSessionPayload, filename?: string): void {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    triggerDownload(
      blob,
      filename ?? `proprio-${payload.packId}-${payload.endedAt.slice(0, 10)}.json`,
    );
  }
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
