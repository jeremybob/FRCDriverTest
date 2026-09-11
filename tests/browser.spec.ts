import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
const output = "output/playwright";
mkdirSync(output, { recursive: true });
const navigate = async (page: Page, name: string) => {
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name, exact: true })
    .click();
};
const free = async (page: Page) => {
  await navigate(page, "Overview");
  await page
    .getByRole("button", { name: "Enter free drive", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Enter the field", exact: true })
    .click();
};
const exit = async (page: Page) => {
  await page.getByRole("button", { name: "Exit driving", exact: true }).click();
};
const beginRecorded = async (page: Page) => {
  await page
    .locator(".course-card.next")
    .getByRole("button", { name: /Record trial/ })
    .click();
  await page
    .getByRole("button", { name: "Start recorded attempt", exact: true })
    .click();
  await expect(page.locator(".countdown")).toBeVisible();
  await expect(page.locator(".countdown")).toBeHidden({ timeout: 7000 });
};

test("major screens, three robots, keyboard motion, cameras, reset, roster and recovery", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Good drivers are built." }),
  ).toBeVisible();
  // Leave previews while parallel shader compilation may still be pending.
  for (let cycle = 0; cycle < 4; cycle++) {
    await navigate(page, "Robot garage");
    await navigate(page, "Overview");
  }
  await page.screenshot({ path: `${output}/overview-1440.png` });
  await navigate(page, "Robot garage");
  await expect(page.locator(".robot-card")).toHaveCount(3);
  await page.screenshot({ path: `${output}/garage-1440.png` });
  for (const kind of ["swerve", "differential", "mecanum"]) {
    await navigate(page, "Robot garage");
    const index = ["swerve", "differential", "mecanum"].indexOf(kind);
    await page.locator(".robot-card").nth(index).getByRole("button").click();
    await free(page);
    await page.waitForTimeout(160);
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(550);
    await page.keyboard.up("KeyW");
    await expect
      .poll(async () =>
        Number(await page.locator(".hud-right b").first().innerText()),
      )
      .toBeGreaterThan(0.2);
    await page.keyboard.down("Space");
    await page.waitForTimeout(800);
    await page.keyboard.up("Space");
    await expect
      .poll(async () =>
        Number(await page.locator(".hud-right b").first().innerText()),
      )
      .toBeLessThan(0.3);
    for (const camera of ["orbit", "chase", "overhead", "station"]) {
      await page.getByLabel("Practice camera").selectOption(camera);
      await page.waitForTimeout(80);
      await expect(page.locator("canvas")).toBeVisible();
    }
    await page.getByLabel("Trail", { exact: true }).check();
    await page.getByLabel("Trail", { exact: true }).uncheck();
    await page.getByRole("button", { name: "Toggle input overlay" }).click();
    await expect(page.locator(".controller-overlay")).toHaveCount(0);
    await page.getByRole("button", { name: "Toggle input overlay" }).click();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("heading", { name: "Take a breath." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Reset to start", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Enter the field", exact: true })
      .click();
    await exit(page);
  }
  await page
    .getByRole("button", { name: "Setup & controls", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Make it feel right." }),
  ).toBeVisible();
  await page.screenshot({ path: `${output}/setup-1440.png` });
  await page.getByRole("button", { name: /Session roster/ }).click();
  await page.getByLabel("New driver name").fill("Browser QA driver");
  await page.getByRole("button", { name: "Add driver", exact: true }).click();
  await expect(page.locator(".roster-list")).toContainText("Browser QA driver");
  await page.reload();
  await expect(page.locator(".driver-switch")).toContainText(
    "Browser QA driver",
  );
  await navigate(page, "Practice");
  await expect(page.locator(".course-card")).toHaveCount(6);
  await page.screenshot({ path: `${output}/practice-1440.png` });
  await navigate(page, "Assessments");
  await page.screenshot({ path: `${output}/assessment-1440.png` });
  await navigate(page, "Driver reports");
  await expect(page.locator(".report-paper")).toContainText("Not attempted");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: `${output}/report-1280.png` });
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  expect(errors).toEqual([]);
});

test("screening outcomes, technical replacement, locked profile, local PDF, print, reload and clear", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Setup & controls", exact: true })
    .click();
  await page
    .getByLabel("Accommodation / exposure override")
    .fill(
      "Exposure override: automated browser verification; not student evidence",
    );
  await navigate(page, "Assessments");
  await beginRecorded(page);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(
    page.getByText("Technical invalidation", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review & continue", exact: true })
    .click();
  for (let i = 0; i < 6; i++) {
    await beginRecorded(page);
    await page
      .getByRole("button", { name: "Abort (DNF)", exact: true })
      .click();
    await expect(
      page.getByText("Did not finish", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Review & continue", exact: true })
      .click();
  }
  await expect(page.getByText("6 / 6 recorded", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Setup & controls", exact: true })
    .click();
  await expect(page.getByLabel("Graphics tier")).toBeDisabled();
  await navigate(page, "Driver reports");
  await expect(page.locator(".skill-row")).toHaveCount(6);
  await expect(page.locator(".skill-row").first()).toContainText("0.0");
  await page
    .getByLabel("Coach notes")
    .fill(
      "Automated QA: six explicit student aborts. Do not interpret as driver evidence.",
    );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs("output/playwright/browser-screening.pdf");
  expect(download.suggestedFilename()).toContain(".pdf");
  await page.evaluate(() => {
    window.print = () => {};
  });
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Print", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.locator("body")).toContainText("DNF");
  await popup.close();
  await page.reload();
  await navigate(page, "Driver reports");
  await expect(page.getByLabel("Coach notes")).toContainText(
    "six explicit student aborts",
  );
  await expect(page.locator(".attempt-detail")).toHaveCount(7);
  await page.screenshot({ path: `${output}/screening-report-1440.png` });
  await page.getByRole("button", { name: /Session roster/ }).click();
  await page
    .getByRole("button", { name: "End session & clear", exact: true })
    .click();
  await page.getByRole("button", { name: "End & clear", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Session cleared." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("frc-driver-lab.session.v1"),
    ),
  ).toBeNull();
  expect(errors).toEqual([]);
});

test("reload during a scored countdown records a visible technical invalidation", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Setup & controls", exact: true })
    .click();
  await page
    .getByLabel("Accommodation / exposure override")
    .fill("Exposure override: reload recovery QA");
  await navigate(page, "Assessments");
  await page
    .locator(".course-card.next")
    .getByRole("button", { name: /Record trial/ })
    .click();
  await page
    .getByRole("button", { name: "Start recorded attempt", exact: true })
    .click();
  await page.reload();
  await navigate(page, "Driver reports");
  await expect(page.locator(".attempt-detail")).toContainText("invalid");
  await page.locator(".attempt-detail > summary").click();
  await expect(page.locator(".attempt-content")).toContainText(
    "Page reload interrupted",
  );
});

test("keyboard completes recorded distance docking and report retains the score", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Setup & controls", exact: true })
    .click();
  await page
    .getByLabel("Accommodation / exposure override")
    .fill(
      "Exposure override: automated keyboard verification; not student evidence",
    );
  await navigate(page, "Assessments");
  await beginRecorded(page);
  // Read-only React HUD inspection supplies feedback to this test controller. All actuation
  // uses real keyboard events; no physics pose, velocity, result or clock is overwritten.
  const readHud = () =>
    page.evaluate(() => {
      const el = document.querySelector("canvas") as HTMLCanvasElement &
        Record<string, unknown>;
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"))!;
      let fiber = el[key] as
        | { memoizedState?: unknown; return?: unknown }
        | undefined;
      while (fiber) {
        let hook = fiber.memoizedState as
          | { memoizedState?: { snapshot?: unknown }; next?: unknown }
          | undefined;
        while (hook) {
          const value = hook.memoizedState;
          if (value?.snapshot)
            return value as unknown as {
              state: string;
              snapshot: { x: number; vx: number };
              feedback: { checkpoint: number; target: { x: number } };
            };
          hook = hook.next as typeof hook;
        }
        fiber = fiber.return as typeof fiber;
      }
      return null;
    });
  let held = new Set<string>(),
    segment = -1;
  for (let step = 0; step < 1100; step++) {
    const hud = await readHud();
    if (!hud || hud.state !== "running") break;
    const dx = hud.feedback.target.x - hud.snapshot.x,
      desired = Math.max(-1.1, Math.min(1.1, dx * 1.6)),
      keys = new Set<string>();
    if (hud.feedback.checkpoint !== segment) segment = hud.feedback.checkpoint;
    else if (
      Math.abs(dx) < 0.065 ||
      Math.abs(hud.snapshot.vx) > Math.abs(desired) + 0.1
    )
      keys.add("Space");
    else {
      keys.add("ShiftLeft");
      keys.add(dx > 0 ? "KeyW" : "KeyS");
    }
    for (const k of held) if (!keys.has(k)) await page.keyboard.up(k);
    for (const k of keys) if (!held.has(k)) await page.keyboard.down(k);
    held = keys;
    await page.waitForTimeout(40);
  }
  for (const k of held) await page.keyboard.up(k);
  await expect(
    page.getByText("Attempt complete", { exact: true }),
  ).toBeVisible();
  const score = (await page.locator(".result-number").innerText())
    .split("/")[0]
    .trim();
  await page
    .getByRole("button", { name: "Review & continue", exact: true })
    .click();
  await navigate(page, "Driver reports");
  await expect(page.locator(".skill-row").first()).toContainText(score);
  await page.locator(".attempt-detail > summary").click();
  await expect(page.locator(".attempt-content")).toContainText(
    "All required gates and dwells completed",
  );
  await expect(
    page.getByRole("button", { name: "Play replay", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play replay", exact: true }).click();
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
});
