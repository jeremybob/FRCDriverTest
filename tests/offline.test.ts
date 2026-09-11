import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import {
  buildOffline,
  isApplicationAsset,
  workerSource,
} from "../scripts/build-offline.mjs";

function harness(version = "1111111111111111") {
  const handlers: Record<string, (event: any) => void> = {};
  const data = new Map<string, Map<string, Response>>();
  const client = {
    id: "tab-1",
    url: `https://lab.test/?frc-build=${version}`,
    postMessage: (_message: unknown) => {},
  };
  const caches = {
    keys: async () => [...data.keys()],
    has: async (name: string) => data.has(name),
    delete: async (name: string) => data.delete(name),
    open: async (name: string) => {
      if (!data.has(name)) data.set(name, new Map());
      const entries = data.get(name)!;
      return {
        match: async (key: Request | string) =>
          entries.get(typeof key === "string" ? key : key.url)?.clone(),
        addAll: async (requests: Request[]) => {
          for (const r of requests)
            entries.set(
              r.url,
              new Response("asset:" + new URL(r.url).pathname),
            );
        },
      };
    },
  };
  let claimed = false,
    skipped = false,
    networkCalls = 0;
  const self = {
    registration: { scope: "https://lab.test/" },
    addEventListener: (name: string, handler: (event: any) => void) => {
      handlers[name] = handler;
    },
    clients: {
      get: async () => client,
      matchAll: async () => [client],
      claim: async () => {
        claimed = true;
      },
    },
    skipWaiting: async () => {
      skipped = true;
    },
  };
  vm.runInNewContext(
    workerSource({
      version,
      assets: ["index.html", "assets/app-hash.js", "fonts/DejaVuSans.ttf"],
    }),
    {
      self,
      caches,
      URL,
      Request,
      Response,
      Map,
      Set,
      Math,
      Date,
      setTimeout,
      clearTimeout,
      fetch: async () => {
        networkCalls++;
        return new Response("network");
      },
    },
  );
  async function lifecycle(name: string) {
    let promise: Promise<unknown> | undefined;
    handlers[name]({
      waitUntil: (p: Promise<unknown>) => {
        promise = p;
      },
    });
    await promise;
  }
  async function request(path: string, mode = "cors", method = "GET") {
    let promise: Promise<Response> | undefined;
    handlers.fetch({
      request: { url: "https://lab.test" + path, mode, method },
      clientId: "tab-1",
      respondWith: (p: Promise<Response>) => {
        promise = p;
      },
    });
    return promise ? await promise : undefined;
  }
  return {
    handlers,
    data,
    client,
    caches,
    lifecycle,
    request,
    get skipped() {
      return skipped;
    },
    get claimed() {
      return claimed;
    },
    get networkCalls() {
      return networkCalls;
    },
  };
}

describe("production offline build isolation", () => {
  it("includes only application assets and excludes exported/student documents", () => {
    expect(isApplicationAsset("index.html")).toBe(true);
    expect(isApplicationAsset("assets/reports-chunk.js")).toBe(true);
    expect(isApplicationAsset("fonts/DejaVuSans.ttf")).toBe(true);
    for (const path of [
      "session.json",
      "reports/driver.pdf",
      "exports/session.json",
      "assets/session/roster.js",
      "assets/app.js.map",
      "uploads/name.png",
    ])
      expect(isApplicationAsset(path)).toBe(false);
  });
  it("generates deterministic manifests including fonts and refreshes hash on changed bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "driver-offline-"));
    try {
      await mkdir(join(dir, "assets"));
      await mkdir(join(dir, "fonts"));
      await mkdir(join(dir, "reports"));
      await writeFile(
        join(dir, "index.html"),
        "<html><head></head><body>App</body></html>",
      );
      await writeFile(join(dir, "assets/app.js"), "console.log(1)");
      await writeFile(join(dir, "fonts/local.ttf"), "font");
      await writeFile(join(dir, "reports/private.pdf"), "must not cache");
      const a = await buildOffline(dir),
        b = await buildOffline(dir);
      expect(a.version).toBe(b.version);
      expect(a.assets).toEqual([
        "assets/app.js",
        "fonts/local.ttf",
        "index.html",
      ]);
      expect(await readFile(join(dir, "index.html"), "utf8")).toContain(
        `content="${a.version}"`,
      );
      expect(await readFile(join(dir, "sw.js"), "utf8")).not.toContain(
        "private.pdf",
      );
      await writeFile(join(dir, "assets/app.js"), "console.log(2)");
      expect((await buildOffline(dir)).version).not.toBe(a.version);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("installs the complete manifest without forcing an update into active tabs", async () => {
    const h = harness();
    await h.lifecycle("install");
    expect(h.skipped).toBe(false);
    await h.lifecycle("activate");
    expect(h.claimed).toBe(true);
    expect(
      await (
        await h.request("/?frc-build=1111111111111111", "navigate")
      )?.text(),
    ).toBe("asset:/index.html");
    expect(await (await h.request("/fonts/DejaVuSans.ttf"))?.text()).toBe(
      "asset:/fonts/DejaVuSans.ttf",
    );
    expect(h.networkCalls).toBe(0);
  });
  it("retains a prior pinned build across activation and serves its own font and HTML", async () => {
    const h = harness("2222222222222222");
    const old = "frc-driver-lab:/:assets:1111111111111111";
    h.data.set(
      old,
      new Map([
        ["https://lab.test/index.html", new Response("old app")],
        ["https://lab.test/fonts/DejaVuSans.ttf", new Response("old font")],
      ]),
    );
    h.client.url = "https://lab.test/?frc-build=1111111111111111";
    await h.lifecycle("install");
    await h.lifecycle("activate");
    expect(h.data.has(old)).toBe(true);
    expect(
      await (
        await h.request("/?frc-build=1111111111111111", "navigate")
      )?.text(),
    ).toBe("old app");
    expect(await (await h.request("/fonts/DejaVuSans.ttf"))?.text()).toBe(
      "old font",
    );
    expect((await h.request("/assets/app-hash.js"))?.status).toBe(503);
    expect(h.networkCalls).toBe(0);
  });
  it("never intercepts or caches report/session requests or posts", async () => {
    const h = harness();
    await h.lifecycle("install");
    expect(await h.request("/reports/student.pdf")).toBeUndefined();
    expect(await h.request("/session.json")).toBeUndefined();
    expect(
      await h.request("/assets/app-hash.js", "cors", "POST"),
    ).toBeUndefined();
    expect(h.networkCalls).toBe(0);
  });
  it("refuses update activation when any open app tab reports an active session", async () => {
    const h = harness();
    h.client.postMessage = (message: any) =>
      h.handlers.message({
        data: { type: "UPDATE_READINESS", token: message.token, ready: false },
        source: { id: "tab-1" },
      });
    let work: Promise<unknown> | undefined, response: unknown;
    h.handlers.message({
      data: { type: "ACTIVATE" },
      ports: [
        {
          postMessage: (r: unknown) => {
            response = r;
          },
        },
      ],
      waitUntil: (p: Promise<unknown>) => {
        work = p;
      },
    });
    await work;
    expect(h.skipped).toBe(false);
    expect(response).toMatchObject({ ok: false });
  });
  it("activates only after all open app tabs acknowledge no active session", async () => {
    const h = harness();
    h.client.postMessage = (message: any) =>
      h.handlers.message({
        data: { type: "UPDATE_READINESS", token: message.token, ready: true },
        source: { id: "tab-1" },
      });
    let work: Promise<unknown> | undefined, response: unknown;
    h.handlers.message({
      data: { type: "ACTIVATE" },
      ports: [
        {
          postMessage: (r: unknown) => {
            response = r;
          },
        },
      ],
      waitUntil: (p: Promise<unknown>) => {
        work = p;
      },
    });
    await work;
    expect(h.skipped).toBe(true);
    expect(response).toMatchObject({ ok: true });
  });
});
