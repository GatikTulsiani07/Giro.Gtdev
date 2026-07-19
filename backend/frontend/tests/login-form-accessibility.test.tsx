import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/features/auth/login-form";

const signIn = vi.fn();
vi.mock("@/features/auth/auth-context", () => ({ useAuth: () => ({ signIn }) }));

describe("login form accessibility", () => {
  it("associates helper and validation text and labels the token visibility control", () => {
    render(<LoginForm />);
    const input = screen.getByLabelText("Giro access token");
    expect(input).toHaveAccessibleDescription("Authentication is validated before the workspace opens.");
    expect(screen.getByRole("button", { name: "Show access token" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Enter workspace" }));
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter an access token.");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an access token.");
  });
});
