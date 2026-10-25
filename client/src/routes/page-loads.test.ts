import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { session } from "#lib/auth.svelte.js";
import { superSession } from "#lib/superAuth.svelte.js";

import { load as loadAltar } from "./acolyte/altar/+page.js";
import { load as loadAdmin } from "./admin/+page.js";
import { load as loadDesigns } from "./admin/designs/+page.js";
import { load as loadDesign } from "./admin/designs/[id]/+page.js";
import { load as loadEvent } from "./event/[id]/+page.js";
import { load as loadVerify } from "./verify/[id]/+page.js";

// Every load function gets its own fetch; the session helpers use the global one
const globalFetch = vi.fn();
const tenant = { id: "t1", name: "Org", email: "a@b.co" };

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Routes a URL to a canned response so each test states only what differs. */
const router = (routes: Record<string, () => Response | Promise<Response>>) =>
  vi.fn(async (url: string) => {
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected request: ${url}`);
    return handler();
  });

// The loaders are typed against generated route types; the tests pass only what they read
const run = <T>(fn: unknown, event: Record<string, unknown>): Promise<T> =>
  (fn as (e: unknown) => Promise<T>)(event);

beforeEach(() => {
  globalFetch.mockReset();
  vi.stubGlobal("fetch", globalFetch);
  vi.spyOn(console, "error").mockImplementation(() => {});
  session.user = null;
  superSession.isAuthenticated = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const signedInTenant = () => globalFetch.mockImplementation(() => Promise.resolve(reply({ user: tenant })));

describe("admin dashboard", () => {
  test("sends signed-out visitors to /login", async () => {
    globalFetch.mockImplementation(() => Promise.resolve(reply({}, 401)));
    await expect(run(loadAdmin, { fetch: vi.fn() })).rejects.toMatchObject({ status: 302, location: "/login" });
  });

  test("loads events and designs", async () => {
    signedInTenant();
    const fetch = router({
      "/api/v1/admin/events": () => reply([{ id: "e1" }]),
      "/api/v1/admin/designs": () => reply([{ id: "d1", name: "Mine" }]),
    });
    expect(await run(loadAdmin, { fetch })).toEqual({
      events: [{ id: "e1" }],
      designs: [{ id: "d1", name: "Mine" }],
    });
  });

  test("shows an empty dashboard instead of crashing when the API fails", async () => {
    signedInTenant();
    const failing = router({
      "/api/v1/admin/events": () => reply("boom", 500),
      "/api/v1/admin/designs": () => reply("boom", 500),
    });
    expect(await run(loadAdmin, { fetch: failing })).toEqual({ events: [], designs: [] });

    const offline = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await run(loadAdmin, { fetch: offline })).toEqual({ events: [], designs: [] });
  });
});

describe("designs list", () => {
  test("requires a session", async () => {
    globalFetch.mockImplementation(() => Promise.resolve(reply({}, 401)));
    await expect(run(loadDesigns, { fetch: vi.fn() })).rejects.toMatchObject({ status: 302, location: "/login" });
  });

  test("returns the tenant's designs, or none when the API fails", async () => {
    signedInTenant();
    expect(await run(loadDesigns, { fetch: router({ "/api/v1/admin/designs": () => reply([{ id: "d1" }]) }) })).toEqual({
      designs: [{ id: "d1" }],
    });
    expect(await run(loadDesigns, { fetch: router({ "/api/v1/admin/designs": () => reply("x", 500) }) })).toEqual({
      designs: [],
    });
  });
});

describe("design editor", () => {
  test("requires a session", async () => {
    globalFetch.mockImplementation(() => Promise.resolve(reply({}, 401)));
    await expect(run(loadDesign, { params: { id: "new" }, fetch: vi.fn() })).rejects.toMatchObject({
      status: 302,
      location: "/login",
    });
  });

  test("'new' loads assets only, without asking for a design", async () => {
    signedInTenant();
    const fetch = router({ "/api/v1/admin/assets": () => reply([{ id: "a1" }]) });
    expect(await run(loadDesign, { params: { id: "new" }, fetch })).toEqual({ assets: [{ id: "a1" }], design: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("loads an existing design with the assets", async () => {
    signedInTenant();
    const design = { id: "d1", name: "Mine", layout: { elements: [] } };
    const fetch = router({
      "/api/v1/admin/assets": () => reply([]),
      "/api/v1/admin/designs/d1": () => reply(design),
    });
    expect(await run(loadDesign, { params: { id: "d1" }, fetch })).toEqual({ assets: [], design });
  });

  test("404s for a design that isn't there (or isn't theirs)", async () => {
    signedInTenant();
    const fetch = router({
      "/api/v1/admin/assets": () => reply([]),
      "/api/v1/admin/designs/gone": () => reply("nope", 404),
    });
    await expect(run(loadDesign, { params: { id: "gone" }, fetch })).rejects.toMatchObject({ status: 404 });
  });
});

describe("public event page", () => {
  const eventUrl = (id: string) => `/api/v1/events/${id}`;

  test("returns the event", async () => {
    const event = { id: "e1", name: "Townhall" };
    expect(await run(loadEvent, { params: { id: "e1" }, fetch: router({ [eventUrl("e1")]: () => reply(event) }) })).toEqual({
      event,
    });
  });

  test("an unknown or malformed event id is a 404; other failures are a 500", async () => {
    for (const [upstream, shown] of [
      [404, 404],
      [422, 404],
      [500, 500],
    ] as const) {
      const fetch = router({ [eventUrl("x")]: () => reply("no", upstream) });
      await expect(run(loadEvent, { params: { id: "x" }, fetch })).rejects.toMatchObject({ status: shown });
    }
  });
});

describe("certificate verification page", () => {
  test("returns the certificate when it is valid", async () => {
    const certificate = { valid: true, attendeeName: "Siti" };
    const fetch = router({ "/api/v1/events/verify/c1": () => reply(certificate) });
    expect(await run(loadVerify, { params: { id: "c1" }, fetch })).toEqual({ certificate, id: "c1" });
  });

  test("shows 'not found' (null) rather than an error for unknown certificates", async () => {
    const fetch = router({ "/api/v1/events/verify/c1": () => reply("no", 404) });
    expect(await run(loadVerify, { params: { id: "c1" }, fetch })).toEqual({ certificate: null, id: "c1" });
  });
});

describe("superadmin altar", () => {
  test("sends everyone but a signed-in superadmin to the landing page", async () => {
    globalFetch.mockImplementation(() => Promise.resolve(reply({}, 401)));
    await expect(run(loadAltar, { fetch: vi.fn() })).rejects.toMatchObject({ status: 302, location: "/" });
  });

  test("loads the pending tenants and the bound souls", async () => {
    globalFetch.mockImplementation(() => Promise.resolve(reply({ id: "s1" })));
    const fetch = router({
      "/api/v1/superadmin/pending": () => reply([{ id: "p1" }]),
      "/api/v1/superadmin/souls": () => reply([{ id: "s1", conjurations: 2 }]),
    });
    expect(await run(loadAltar, { fetch })).toEqual({
      pendingTenants: [{ id: "p1" }],
      boundSouls: [{ id: "s1", conjurations: 2 }],
    });
  });

  test("returns empty lists when either call fails", async () => {
    globalFetch.mockImplementation(() => Promise.resolve(reply({ id: "s1" })));
    const fetch = router({
      "/api/v1/superadmin/pending": () => reply([]),
      "/api/v1/superadmin/souls": () => reply("x", 500),
    });
    expect(await run(loadAltar, { fetch })).toEqual({ pendingTenants: [], boundSouls: [] });
  });
});
