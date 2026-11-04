import { cloneElement, isValidElement } from "react";
import type { ReactElement } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeFairness } from "../../test/fixtures";
import type { AlgorithmFairness } from "../../api/types";
import FairnessCharts, { formatRatio, groupFairness, passesRule } from "./FairnessCharts";

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

function algo(over: Partial<AlgorithmFairness> = {}): AlgorithmFairness {
  return { ...makeFairness().hungarian!, ...over };
}

function panel(name: string): HTMLElement {
  return screen.getByRole("group", { name: `Disparate impact: ${name}` });
}

describe("FairnessCharts", () => {
  it("shows the skipped reason when fairness is null", () => {
    render(<FairnessCharts fairness={null} skippedReason="No demographics recorded" />);
    expect(screen.getByText(/No demographics recorded/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a generic empty state without a reason", () => {
    render(<FairnessCharts fairness={null} />);
    expect(screen.getByText(/Fairness was not computed/)).toBeInTheDocument();
  });

  it("fails the four-fifths rule at ratio 0.67 with icon and text", () => {
    const f = makeFairness({
      hungarian: algo({ disparate_impact_ratio: 0.67, passes_four_fifths: false }),
    });
    render(<FairnessCharts fairness={f} />);
    const p = panel("Hungarian");
    expect(within(p).getByText("Fails four-fifths rule")).toBeInTheDocument();
    expect(within(p).getByTestId("status-badge")).toHaveAttribute("data-status", "fail");
    expect(p.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(within(p).getByText("0.670")).toBeInTheDocument();
  });

  it("passes at 0.9 and at the exact boundary 0.8", () => {
    const f = makeFairness({
      hungarian: algo({ disparate_impact_ratio: 0.9 }),
      gale_shapley: algo({ disparate_impact_ratio: 0.8, passes_four_fifths: true }),
    });
    render(<FairnessCharts fairness={f} />);
    expect(within(panel("Hungarian")).getByText("Passes four-fifths rule")).toBeInTheDocument();
    expect(within(panel("Gale-Shapley")).getByText("Passes four-fifths rule")).toBeInTheDocument();
  });

  it("labels the 0.8 threshold line and shows parity difference", () => {
    render(<FairnessCharts fairness={makeFairness()} />);
    const p = panel("Hungarian");
    expect(within(p).getByText(/0\.8 threshold/)).toBeInTheDocument();
    expect(within(p).getByText(/Parity difference/)).toBeInTheDocument();
    expect(within(p).getByText("0.10")).toBeInTheDocument();
    expect(within(p).getByRole("img", { name: /ratio 0\.800.*threshold 0\.8/i })).toBeInTheDocument();
  });

  it("renders the grouped selection-rate chart with legend for two algorithms", () => {
    const { container } = render(<FairnessCharts fairness={makeFairness()} />);
    expect(screen.getByRole("heading", { name: "Selection rate by group" })).toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-bar-rectangle").length).toBe(4);
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getByText("Hungarian")).toBeInTheDocument();
    expect(within(legend).getByText("Gale-Shapley")).toBeInTheDocument();
  });

  it("only one algorithm: no legend and bars only for that algorithm", () => {
    const { container } = render(
      <FairnessCharts fairness={makeFairness({ gale_shapley: undefined })} />,
    );
    expect(container.querySelectorAll(".recharts-bar-rectangle").length).toBe(2);
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
    expect(screen.queryByText("Gale-Shapley")).toBeNull();
  });

  it("table view lists the same rates", async () => {
    const user = userEvent.setup();
    render(<FairnessCharts fairness={makeFairness()} />);
    await user.click(screen.getAllByRole("button", { name: "Table" })[0] as HTMLElement);
    const t = screen.getByRole("table");
    expect(within(t).getAllByText("50.0%").length).toBeGreaterThan(0);
    expect(within(t).getAllByText("40.0%").length).toBeGreaterThan(0);
  });

  it("shows a group with size 0 without NaN", async () => {
    const user = userEvent.setup();
    const f = makeFairness({
      hungarian: algo({
        groups: [
          { group: "A", size: 10, selected: 5, selection_rate: 0.5, mean_score: 0.7 },
          { group: "Empty", size: 0, selected: 0, selection_rate: 0, mean_score: 0 },
        ],
      }),
    });
    const { container } = render(<FairnessCharts fairness={f} />);
    await user.click(screen.getAllByRole("button", { name: "Table" })[0] as HTMLElement);
    expect(screen.getAllByText("Empty").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/NaN|Infinity|undefined/);
  });

  it.each([
    ["rate above 1", { selection_rate: 1.4 }],
    ["negative rate", { selection_rate: -0.1 }],
    ["NaN rate", { selection_rate: NaN }],
    ["negative size", { size: -3 }],
  ])("renders an inline error panel for %s", (_n, bad) => {
    const f = makeFairness({
      hungarian: algo({
        groups: [{ group: "A", size: 10, selected: 5, selection_rate: 0.5, mean_score: 0.7, ...bad }],
      }),
    });
    render(<FairnessCharts fairness={f} />);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("renders an error panel for empty groups and non-finite ratio", () => {
    const f = makeFairness({
      hungarian: algo({ groups: [] }),
      gale_shapley: algo({ disparate_impact_ratio: Infinity }),
    });
    render(<FairnessCharts fairness={f} />);
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(1);
  });

  it("truncates long group names but keeps the full name in a title", async () => {
    const long = "A very long demographic group label that overflows";
    const f = makeFairness({
      hungarian: algo({
        groups: [{ group: long, size: 4, selected: 2, selection_rate: 0.5, mean_score: 0.5 }],
      }),
    });
    const { container } = render(<FairnessCharts fairness={f} />);
    const titles = Array.from(container.querySelectorAll("title")).map((t) => t.textContent);
    expect(titles).toContain(long);
    const tick = Array.from(container.querySelectorAll("text")).find((t) => t.querySelector("title"));
    expect(tick?.textContent).toContain("…");
    expect(tick?.lastChild?.textContent).not.toContain(long);
  });
});

describe("ratio display and flag", () => {
  it("never rounds a failing ratio up: 35/44 shows 0.795 and fails", () => {
    const f = makeFairness({
      hungarian: algo({ disparate_impact_ratio: 35 / 44, passes_four_fifths: false }),
    });
    render(<FairnessCharts fairness={f} />);
    const p = panel("Hungarian");
    expect(within(p).getByText("0.795")).toBeInTheDocument();
    expect(within(p).queryByText("0.800")).toBeNull();
    expect(within(p).getByText("Fails four-fifths rule")).toBeInTheDocument();
  });

  it("exactly 0.8 passes and shows 0.800", () => {
    const f = makeFairness({ hungarian: algo({ disparate_impact_ratio: 0.8, passes_four_fifths: true }) });
    render(<FairnessCharts fairness={f} />);
    expect(within(panel("Hungarian")).getByText("0.800")).toBeInTheDocument();
    expect(within(panel("Hungarian")).getByText("Passes four-fifths rule")).toBeInTheDocument();
  });

  it("takes pass/fail from the server flag regardless of the ratio", () => {
    const f = makeFairness({
      hungarian: algo({ disparate_impact_ratio: 0.9, passes_four_fifths: false }),
      gale_shapley: algo({ disparate_impact_ratio: 0.5, passes_four_fifths: true }),
    });
    render(<FairnessCharts fairness={f} />);
    expect(within(panel("Hungarian")).getByText("Fails four-fifths rule")).toBeInTheDocument();
    expect(within(panel("Gale-Shapley")).getByText("Passes four-fifths rule")).toBeInTheDocument();
  });

  it("falls back to the ratio when the flag is missing or not a boolean", () => {
    expect(passesRule({ disparate_impact_ratio: 0.8 })).toBe(true);
    expect(passesRule({ disparate_impact_ratio: 0.79, passes_four_fifths: "yes" })).toBe(false);
  });

  it("formatRatio floors to 3 decimals", () => {
    expect(formatRatio(0.7955)).toBe("0.795");
    expect(formatRatio(0.8)).toBe("0.800");
    expect(formatRatio(0.9)).toBe("0.900");
    expect(formatRatio(1)).toBe("1.000");
  });
});

describe("groupFairness", () => {
  const mk = (n: number): AlgorithmFairness["groups"] =>
    Array.from({ length: n }, (_, i) => ({
      group: `G${i}`,
      size: 10 + i,
      selected: 5,
      selection_rate: 0.5,
      mean_score: 0.5,
    }));

  it("keeps up to 12 groups unchanged", () => {
    expect(groupFairness(mk(12))).toHaveLength(12);
  });

  it("folds the tail into Other beyond 12 groups (11 + Other)", () => {
    const out = groupFairness(mk(20));
    expect(out).toHaveLength(12);
    const other = out[11]!;
    expect(other.group).toBe("Other");
    // 9 groups folded: sizes of the smallest ones
    expect(other.size).toBeGreaterThan(0);
    expect(other.selection_rate).toBeCloseTo(other.selected / other.size, 6);
    expect(out.map((g) => g.group)).not.toContain("G0");
  });
});
