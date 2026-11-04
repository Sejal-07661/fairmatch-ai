import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { RunStatus } from "./RunStatus";

const T0 = Date.parse("2026-11-04T10:00:00Z");

afterEach(() => vi.useRealTimers());

describe("RunStatus", () => {
  it.each([
    ["pending", "Pending"],
    ["running", "Running"],
    ["done", "Done"],
    ["failed", "Failed"],
  ])("test_status_%s_has_icon_and_text", (status, label) => {
    const { container } = render(<RunStatus run={{ id: 1, status, error: null }} waitingSince={null} />);
    const badge = screen.getByTestId("run-status-badge");
    expect(badge).toHaveTextContent(label);
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("[aria-live='polite']")).toHaveTextContent(label);
  });

  it("test_unknown_status_is_shown_as_unknown", () => {
    render(<RunStatus run={{ id: 1, status: "weird<b>", error: null }} waitingSince={null} />);
    expect(screen.getByTestId("run-status-badge")).toHaveTextContent("Unknown");
  });

  it("test_failed_shows_error_text_as_plain_text", () => {
    render(<RunStatus run={{ id: 1, status: "failed", error: "<script>alert(1)</script> boom" }} waitingSince={null} />);
    expect(screen.getByText("<script>alert(1)</script> boom")).toBeInTheDocument();
  });

  it("test_waiting_time_increments_and_stuck_note_after_60s", () => {
    vi.useFakeTimers({ now: T0 + 5000 });
    render(<RunStatus run={{ id: 1, status: "running", error: null }} waitingSince={T0} />);
    expect(screen.getByText(/waiting 5s/i)).toBeInTheDocument();
    expect(screen.queryByText(/taking longer than usual/i)).toBeNull();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByText(/waiting 15s/i)).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(50_000));
    expect(screen.getByText(/waiting 1m 05s/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        "This run is taking longer than usual; it may be stuck. Runs interrupted by a server restart are not recovered automatically.",
      ),
    ).toHaveAttribute("role", "status");
  });

  it("test_done_shows_no_waiting_or_stuck_note", () => {
    render(<RunStatus run={{ id: 1, status: "done", error: null }} waitingSince={T0 - 600_000} />);
    expect(screen.queryByText(/waiting/i)).toBeNull();
    expect(screen.queryByText(/taking longer/i)).toBeNull();
  });

  it("test_invalid_waiting_since_does_not_render_nan", () => {
    render(<RunStatus run={{ id: 1, status: "pending", error: null }} waitingSince={Number.NaN} />);
    expect(document.body.textContent).not.toMatch(/NaN|Invalid/);
  });

  it("test_refresh_button_calls_handler", async () => {
    const onRefresh = vi.fn();
    render(<RunStatus run={{ id: 1, status: "pending", error: null }} waitingSince={null} onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
