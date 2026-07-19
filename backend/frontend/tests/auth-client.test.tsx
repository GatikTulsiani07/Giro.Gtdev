import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/features/auth/auth-context";
import { apiRequest } from "@/services/api/client";

const replace = vi.fn();
const navigation = vi.hoisted(() => ({ pathname: "/dashboard" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace }),
}));

function AuthProbe() {
  const { token, ready } = useAuth();
  return <span>{ready ? token ?? "signed-out" : "loading"}</span>;
}

describe("authentication integration", () => {
  beforeEach(() => {
    replace.mockReset();
    navigation.pathname = "/dashboard";
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("clears an invalid session token globally and preserves the intended destination", async () => {
    sessionStorage.setItem("giro.access-token", "invalid-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      error: { code: "invalid_token", message: "Invalid token" },
      requestId: "req-auth",
    }), { status: 401, headers: { "Content-Type": "application/json" } })));
    render(<AuthProvider><AuthProbe /></AuthProvider>);
    await screen.findByText("invalid-token");
    await expect(apiRequest("/sessions", { method: "GET", token: "invalid-token" })).rejects.toMatchObject({ status: 401 });
    await waitFor(() => {
      expect(sessionStorage.getItem("giro.access-token")).toBeNull();
      expect(replace).toHaveBeenCalledWith("/login?next=%2Fdashboard");
    });
    expect(screen.getByText("signed-out")).toBeInTheDocument();
  });

  it("keeps the public homepage available without an access token", async () => {
    navigation.pathname = "/";
    render(<AuthProvider><AuthProbe /></AuthProvider>);
    await screen.findByText("signed-out");
    expect(replace).not.toHaveBeenCalled();
  });
});
