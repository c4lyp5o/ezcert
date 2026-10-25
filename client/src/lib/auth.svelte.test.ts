import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { initSession, logoutUser, session } from "./auth.svelte.js";
import { initSuperSession, logoutSuperAdmin, superSession } from "./superAuth.svelte.js";

const fetchMock = vi.fn();
const hrefSetter = vi.fn();

const tenant = { id: "1", name: "Org", email: "a@b.co" };
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  session.user = null;
  superSession.isAuthenticated = false;
  // jsdom can't navigate; capture assignments to location.href instead
  hrefSetter.mockReset();
  vi.stubGlobal("location", Object.defineProperty({}, "href", { set: (v: string) => hrefSetter(v), get: () => "" }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("tenant session", () => {
  test("initSession stores the signed-in tenant", async () => {
    fetchMock.mockReturnValue(json({ user: tenant }));
    await initSession();
    expect(session.user).toEqual(tenant);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/admin/me", { credentials: "include" });
  });

  test("initSession clears the user on 401 and on network errors", async () => {
    session.user = tenant;
    fetchMock.mockReturnValue(json({}, 401));
    await initSession();
    expect(session.user).toBeNull();

    session.user = tenant;
    fetchMock.mockRejectedValue(new Error("offline"));
    await initSession();
    expect(session.user).toBeNull();
  });

  test("logoutUser clears the session and goes to /login, even if the call fails", async () => {
    session.user = tenant;
    fetchMock.mockRejectedValue(new Error("offline"));
    await logoutUser();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/admin/logout", { method: "POST", credentials: "include" });
    expect(session.user).toBeNull();
    expect(hrefSetter).toHaveBeenCalledWith("/login");
  });
});

describe("superadmin session", () => {
  test("initSuperSession follows the response status", async () => {
    fetchMock.mockReturnValue(json({ id: "1" }));
    await initSuperSession();
    expect(superSession.isAuthenticated).toBe(true);

    fetchMock.mockReturnValue(json({}, 401));
    await initSuperSession();
    expect(superSession.isAuthenticated).toBe(false);
  });

  test("initSuperSession is false on network errors", async () => {
    superSession.isAuthenticated = true;
    fetchMock.mockRejectedValue(new Error("offline"));
    await initSuperSession();
    expect(superSession.isAuthenticated).toBe(false);
  });

  test("logoutSuperAdmin signs out and returns to the landing page", async () => {
    superSession.isAuthenticated = true;
    fetchMock.mockReturnValue(json({}));
    await logoutSuperAdmin();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/super/logout", { method: "POST", credentials: "include" });
    expect(superSession.isAuthenticated).toBe(false);
    expect(hrefSetter).toHaveBeenCalledWith("/");
  });
});
