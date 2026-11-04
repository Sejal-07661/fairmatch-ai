import { cloneElement, isValidElement } from "react";
import type { ReactElement } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeMetrics } from "../../test/fixtures";
import ComparisonCharts from "./ComparisonCharts";
import { ALGORITHM_COLORS } from "./theme";

vi.mock("recharts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("recharts")>();
  return {
    ...mod,
    ResponsiveContainer: ({ children, height }: { children: ReactElement; height?: number }) => {
      const h = typeof height === "number" ? height : 240;
      return (
        <div style={{ width: 600, height: h }}>
          {isValidElement(children)
            ? cloneElement(children as ReactElement<{ width: number; height: number }>, {
                width: 600,
                height: h,
              })
            : children}
        </div>
      );
    },
  };
});

// A zero-valued bar has no height and Recharts draws no rectangle for it, so these
// tests use non-zero values everywhere.
const NONZERO = makeMetrics({
  gale_shapley: { total_score: 4, blocking_pairs: 1, runtime_ms: 1.2, unallocated: [] },
});

function fills(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll(".recharts-bar-rectangle path")).map((p) =>
    p.getAttribute("fill"),
  );
}

describe("ComparisonCharts", () => {
  it("renders three small-multiple charts with one bar per algorithm", () => {
    const { container } = render(<ComparisonCharts metrics={NONZERO} />);
    expect(screen.getByRole("heading", { name: "Total score" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Blocking pairs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Runtime (ms)" })).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(container.querySelectorAll(".recharts-bar-rectangle").length).toBe(6);
    // each chart has at most one y axis: no dual axis
    expect(container.querySelectorAll(".recharts-yAxis").length).toBeLessThanOrEqual(3);
    // direct value labels
    expect(screen.getAllByText("4.20").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3.50").length).toBeGreaterThan(0);
  });

  it("summarises values in the aria-label", () => {
    render(<ComparisonCharts metrics={makeMetrics()} />);
    expect(
      screen.getByRole("img", { name: /Hungarian 4\.20.*Gale-Shapley 4\.00/ }),
    ).toBeInTheDocument();
  });

  it("lists both algorithms in the legend", () => {
    render(<ComparisonCharts metrics={makeMetrics()} />);
    for (const list of screen.getAllByRole("list", { name: "Legend" })) {
      expect(within(list).getByText("Hungarian")).toBeInTheDocument();
      expect(within(list).getByText("Gale-Shapley")).toBeInTheDocument();
    }
  });

  it("shows one series and keeps its colour when only hungarian is present", () => {
    const { container } = render(
      <ComparisonCharts metrics={makeMetrics({ gale_shapley: undefined })} />,
    );
    expect(container.querySelectorAll(".recharts-bar-rectangle").length).toBe(3);
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
    expect(screen.queryByText("Gale-Shapley")).toBeNull();
    const f = fills(container);
    expect(f.length).toBe(3);
    expect(f.every((x) => x === ALGORITHM_COLORS.hungarian)).toBe(true);
  });

  it("keeps the gale_shapley colour when hungarian is missing", () => {
    const { container } = render(
      <ComparisonCharts metrics={{ ...NONZERO, hungarian: undefined }} />,
    );
    const f = fills(container);
    expect(f.length).toBe(3);
    expect(f.every((x) => x === ALGORITHM_COLORS.gale_shapley)).toBe(true);
  });

  it("table toggle shows the same numbers", async () => {
    const user = userEvent.setup();
    render(<ComparisonCharts metrics={makeMetrics()} />);
    const buttons = screen.getAllByRole("button", { name: "Table" });
    expect(buttons).toHaveLength(3);
    await user.click(buttons[0] as HTMLElement);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Hungarian")).toBeInTheDocument();
    expect(within(table).getByText("4.20")).toBeInTheDocument();
    expect(within(table).getByText("4.00")).toBeInTheDocument();
  });

  it.each([
    ["NaN", { total_score: NaN }],
    ["Infinity", { runtime_ms: Infinity }],
    ["negative blocking pairs", { blocking_pairs: -1 }],
  ])("renders an inline error panel for %s", (_n, bad) => {
    const base = makeMetrics().hungarian!;
    render(<ComparisonCharts metrics={makeMetrics({ hungarian: { ...base, ...bad } })} />);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("renders an error panel when no algorithm results exist", () => {
    render(<ComparisonCharts metrics={{}} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/No algorithm results/);
  });

  describe("zero values", () => {
    const zero = (blocking: number) => ({ total_score: 4, blocking_pairs: blocking, runtime_ms: 1, unallocated: [] });

    it("labels and draws a visible stub for all-zero blocking pairs", async () => {
      const user = userEvent.setup();
      const { container } = render(
        <ComparisonCharts metrics={{ hungarian: zero(0), gale_shapley: zero(0) }} />,
      );
      const labels = Array.from(container.querySelectorAll("text")).filter((t) => t.textContent === "0");
      // two value labels ("0") on the blocking-pairs chart; y-axis tick "0" is separate
      expect(labels.length).toBeGreaterThanOrEqual(2);
      const bars = container.querySelectorAll(".recharts-bar-rectangle");
      expect(bars.length).toBe(6);
      await user.click(screen.getAllByRole("button", { name: "Table" })[1] as HTMLElement);
      const t = screen.getByRole("table");
      expect(within(t).getAllByText("0")).toHaveLength(2);
    });

    it("labels the zero in mixed-zero data", () => {
      const { container } = render(
        <ComparisonCharts metrics={{ hungarian: zero(2), gale_shapley: zero(0) }} />,
      );
      const valueLabels = Array.from(container.querySelectorAll(".recharts-label-list text")).map(
        (t) => t.textContent,
      );
      expect(valueLabels).toContain("0");
      expect(valueLabels).toContain("2");
    });
  });
});
