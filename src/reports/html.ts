import type { ReportModel } from "./model";
import { attemptLines, formatScore, profileLines } from "./model";
import type { PageSize } from "./pdf";
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function reportHtml(
  model: ReportModel,
  pageSize: PageSize = "letter",
): string {
  const esc = escapeHtml;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FRC Driver Lab report</title><style>@page{size:${pageSize === "a4" ? "A4" : "letter"};margin:14mm}*{box-sizing:border-box}body{color:#202428;font:11pt system-ui,sans-serif;margin:0;padding:20px}h1{font-size:24pt;margin:0}h2{font-size:18pt}h3{font-size:12pt}p,li{line-height:1.45;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:10pt}th,td{text-align:left;padding:8px 5px;border-bottom:1px solid #aaa}progress{display:block;width:90px;height:5px;accent-color:#333}.summary{break-before:page}.summary:first-child{break-before:auto}.details{break-before:page}.context{font-size:9pt;color:#444}.line{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}.attempt{margin:18px 0}.attempt h3{break-after:avoid}.bar{display:block;background:#eee;width:90px;height:4px;margin-top:5px}.bar i{display:block;background:#444;height:4px}.report-footer{font-size:8pt;border-top:1px solid #aaa;margin-top:20px}@media print{body{padding:0}.report-footer{position:running(footer)}a{color:inherit}}</style></head><body>${model.drivers
    .map(
      (d) =>
        `<section class="summary"><h1>FRC DRIVER LAB</h1><h2>${esc(d.name)}</h2><p>${esc(model.sessionLabel)} | ${esc(model.createdAt.slice(0, 10))} | ${model.suite === "screening" ? "PRELIMINARY SCREENING" : "FULL ASSESSMENT"}</p><p><strong>${d.assessment.eligible ? "Required evidence complete" : "INCOMPLETE - required evidence is missing"}</strong></p><p class="context">${esc(profileLines(model.profile)[0])}</p><table><thead><tr><th>Skill</th><th>Score / 100</th><th>All trials</th><th>Completed</th><th>Contacts</th></tr></thead><tbody>${d.assessment.skills.map((s) => `<tr><td>${esc(s.name)}</td><td>${formatScore(s.score)}${s.score === null ? "" : `<span class="bar"><i style="width:${s.score}%"></i></span>`}</td><td>${(s.trials.map((t) => t.toFixed(1)).join(" / ") || "Missing") + (s.min === null ? "" : `<br><small>Range ${s.min.toFixed(1)}-${s.max!.toFixed(1)}</small>`)}</td><td>${s.completed}/${model.suite === "full" ? 3 : 1}</td><td>${s.contacts}</td></tr>`).join("")}</tbody></table>${d.assessment.coreIndex === null ? "" : `<p>Core index: ${formatScore(d.assessment.coreIndex)} / 100</p>`}${d.assessment.consistency === null ? "" : `<p>Repeatability: ${formatScore(d.assessment.consistency)} / 100 (separate from proficiency)</p>`}<p>${esc(d.assessment.reason)}</p><h3>Relative strengths</h3><p>${esc(d.strengths.join("; ") || "Insufficient scored evidence.")}</p><h3>Next practice priorities</h3><ul>${
          d.assessment.recommendations
            .slice(0, 2)
            .map((r) => `<li>${esc(r)}</li>`)
            .join("") ||
          "<li>Complete guided practice and collect required trials.</li>"
        }</ul><p class="context">${esc(model.disclaimer)}</p></section><section class="details"><h2>${esc(d.name)} - Context and attempts</h2>${profileLines(
          model.profile,
        )
          .map((p) => `<p class="context">${esc(p)}</p>`)
          .join(
            "",
          )}<h3>Coach notes</h3><p class="line">${esc(d.notes || "No coach notes entered.")}</p><h3>Attempt history</h3>${
          d.attempts
            .map(
              (a) =>
                `<article class="attempt">${attemptLines(a)
                  .map((l) => `<p class="line">${esc(l)}</p>`)
                  .join("")}</article>`,
            )
            .join("") ||
          "<p>No attempts recorded. Missing evidence is not scored as zero.</p>"
        }<footer class="report-footer">FRC Driver Lab | Profile ${esc(model.profile.id)} / ${esc(model.profile.hash)}</footer></section>`,
    )
    .join("")}</body></html>`;
}
/** Call directly from a click handler so the browser permits the report window. */
export function printReport(
  model: ReportModel,
  pageSize: PageSize = "letter",
): void {
  const popup = window.open("", "_blank");
  if (!popup)
    throw new Error(
      "The report window was blocked. Allow popups for this local app and try Print again.",
    );
  popup.document.open();
  popup.document.write(reportHtml(model, pageSize));
  popup.document.close();
  popup.focus();
  popup.setTimeout(() => popup.print(), 250);
}
