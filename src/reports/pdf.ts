import { PDFDocument, rgb } from "pdf-lib";
import type { PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ReportModel } from "./model";
import { attemptLines, formatScore, profileLines } from "./model";
export type PageSize = "letter" | "a4";
export const PAGE_DIMENSIONS: Record<PageSize, [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};
/** Word wrap also splits very long unbroken strings, without dropping text. */
export function wrapText(
  text: string,
  width: number,
  measure: (s: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= width) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      for (const c of word) {
        if (line && measure(line + c) > width) {
          lines.push(line);
          line = "";
        }
        line += c;
      }
    }
    lines.push(line);
  }
  return lines;
}
export async function generatePdf(
  model: ReportModel,
  pageSize: PageSize = "letter",
  fontBytes?: Uint8Array,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  let bytes = fontBytes;
  if (!bytes) {
    const response = await fetch(
      `${import.meta.env.BASE_URL}fonts/DejaVuSans.ttf`,
    );
    if (!response.ok)
      throw new Error(
        "The local report font is unavailable. Reload the application assets and try again.",
      );
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const font = await doc.embedFont(bytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  // Retain an explicit code point for unsupported characters, never silent tofu boxes.
  const safe = (s: string) =>
    Array.from(s)
      .map((c) =>
        c === "\n"
          ? c
          : c === "\t"
            ? "    "
            : supported.has(c.codePointAt(0)!)
              ? c
              : `[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`,
      )
      .join("");
  const [width, height] = PAGE_DIMENSIONS[pageSize];
  const margin = 42;
  const area = width - 2 * margin;
  let page!: PDFPage;
  let y = height - margin;
  let currentDriver = "";
  const gray = rgb(0.2, 0.23, 0.25),
    light = rgb(0.89, 0.9, 0.91);
  const newPage = (detail = false) => {
    page = doc.addPage([width, height]);
    y = height - margin;
    if (detail) {
      draw("FRC DRIVER LAB / ATTEMPT DETAIL", 11);
      draw(
        `${currentDriver} | profile ${model.profile.id} / ${model.profile.hash}; rubric ${model.profile.rubricVersion}`,
        8,
      );
      y -= 8;
    }
  };
  function draw(text: string, size = 9, space = 4, color = gray) {
    const lines = wrapText(safe(text), area, (s) =>
      font.widthOfTextAtSize(s, size),
    );
    for (const line of lines) {
      if (y - size < 44) newPage(true);
      page.drawText(line, { x: margin, y: y - size, size, font, color });
      y -= size + space;
    }
  }
  function tableCell(text: string, x: number, rowY: number, size = 9) {
    page.drawText(safe(text), { x, y: rowY, size, font, color: gray });
  }
  for (const driver of model.drivers) {
    currentDriver = driver.name;
    newPage();
    draw("FRC DRIVER LAB", 21, 6);
    draw(driver.name, 15, 3);
    draw(
      `${model.sessionLabel} | ${model.createdAt.slice(0, 10)} | ${model.suite === "screening" ? "PRELIMINARY SCREENING" : "FULL ASSESSMENT"}`,
      9,
      3,
    );
    draw(
      driver.assessment.eligible
        ? "Required evidence complete"
        : "INCOMPLETE - required assessment evidence is missing",
      10,
      7,
    );
    draw(`Profile ${model.profile.id} / ${model.profile.hash}`, 8, 3);
    draw(
      `${model.profile.robot.name} / ${model.profile.controlFrame}-relative / ${model.profile.inputClass} / ${model.profile.camera} camera`,
      8,
      3,
    );
    draw(
      "Provisional rubrics; uncalibrated presets; hardware qualification remains external.",
      8,
      10,
    );
    const col = {
      skill: margin,
      score: margin + 190,
      trials: margin + 245,
      done: margin + 370,
      contacts: margin + 435,
    };
    tableCell("Skill", col.skill, y, 8);
    tableCell("Score", col.score, y, 8);
    tableCell("Trial scores", col.trials, y, 8);
    tableCell("Done", col.done, y, 8);
    tableCell("Contacts", col.contacts, y, 8);
    y -= 17;
    for (const skill of driver.assessment.skills) {
      tableCell(skill.name, col.skill, y, 9);
      tableCell(formatScore(skill.score), col.score, y, 9);
      tableCell(
        skill.trials.map((v) => v.toFixed(1)).join(" / ") || "-",
        col.trials,
        y,
        8,
      );
      tableCell(
        `${skill.completed}/${model.suite === "full" ? 3 : 1}`,
        col.done,
        y,
        9,
      );
      tableCell(String(skill.contacts), col.contacts, y, 9);
      y -= 10;
      if (skill.min !== null)
        tableCell(
          `Range ${skill.min.toFixed(1)}-${skill.max!.toFixed(1)}`,
          col.trials,
          y - 3,
          6.5,
        );
      page.drawRectangle({
        x: col.skill,
        y: y - 3,
        width: 165,
        height: 3,
        color: light,
      });
      if (skill.score !== null)
        page.drawRectangle({
          x: col.skill,
          y: y - 3,
          width: (165 * skill.score) / 100,
          height: 3,
          color: gray,
        });
      y -= 19;
    }
    if (driver.assessment.coreIndex !== null)
      draw(
        `Core index: ${formatScore(driver.assessment.coreIndex)} / 100`,
        11,
        4,
      );
    if (driver.assessment.consistency !== null)
      draw(
        `Repeatability: ${formatScore(driver.assessment.consistency)} / 100 (separate from proficiency)`,
        9,
        4,
      );
    draw(driver.assessment.reason, 8, 7);
    draw("Relative strengths", 10, 3);
    draw(driver.strengths.join("; ") || "Insufficient scored evidence.", 9, 7);
    draw("Next practice priorities", 10, 3);
    for (const drill of driver.assessment.recommendations.slice(0, 2))
      draw(drill, 9, 3);
    if (!driver.assessment.recommendations.length)
      draw("Complete guided practice and collect the required trials.", 9, 3);
    y -= 5;
    draw(
      `Technical invalidations: ${driver.invalidations.length}. Full attempt history, metric units, score calculations, comparison context and coach notes follow.`,
      8,
      6,
    );
    draw(model.disclaimer, 8, 3);
    newPage(true);
    draw("COMPARISON CONTEXT", 12, 5);
    for (const line of profileLines(model.profile)) draw(line);
    draw(`Session ${model.sessionId}; ${model.createdAt}`, 8, 6);
    draw("COACH NOTES", 11, 4);
    draw(driver.notes || "No coach notes entered.", 9, 5);
    draw("ATTEMPT HISTORY", 12, 5);
    if (!driver.attempts.length)
      draw("No attempts recorded. Missing evidence is not scored as zero.");
    for (const attempt of driver.attempts) {
      if (y < 180) newPage(true);
      for (const line of attemptLines(attempt)) draw(line, 8.5, 3);
      y -= 12;
    }
  }
  if (!model.drivers.length) {
    newPage();
    draw("FRC DRIVER LAB", 21);
    draw("No drivers selected for this report.");
  }
  const exportedAt = new Date().toISOString();
  doc
    .getPages()
    .forEach((p, i) =>
      p.drawText(
        `FRC Driver Lab | ${pageSize === "a4" ? "A4" : "US Letter"} | Page ${i + 1} of ${doc.getPageCount()} | Export ${exportedAt}`,
        { x: margin, y: 23, font, size: 7, color: gray },
      ),
    );
  doc.setTitle("FRC Driver Lab - Driver Report");
  doc.setSubject(
    "Provisional driving assessment with frozen attempt provenance",
  );
  doc.setCreator(`FRC Driver Lab ${model.profile.buildId}`);
  doc.setCreationDate(new Date());
  return doc.save();
}
