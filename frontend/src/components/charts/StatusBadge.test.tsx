import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StatusBadge from "./StatusBadge";

describe("StatusBadge", () => {
  it("shows an icon and text for fail", () => {
    const { container } = render(<StatusBadge status="fail" label="Fails four-fifths rule" />);
    expect(screen.getByText("Fails four-fifths rule")).toBeInTheDocument();
    expect(container.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(screen.getByTestId("status-badge")).toHaveAttribute("data-status", "fail");
  });

  it("uses a different icon shape for pass", () => {
    const pass = render(<StatusBadge status="pass" label="Pass" />);
    const failed = render(<StatusBadge status="fail" label="Fail" />);
    const p = pass.container.querySelector("svg path")?.getAttribute("d");
    const f = failed.container.querySelector("svg path")?.getAttribute("d");
    expect(p).toBeTruthy();
    expect(p).not.toEqual(f);
  });
});
