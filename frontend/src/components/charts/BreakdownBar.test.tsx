import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ScoreBreakdown } from "../../api/types";
import { makeAllocation } from "../../test/fixtures";
import BreakdownBar, { DEFAULT_WEIGHTS, contributions } from "./BreakdownBar";

function bd(over: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return {
    semantic: 0.5,
    skill_overlap: 0.5,
    experience: 1,
    education: 0.5,
    matched_skills: ["python", "sql"],
    related_skills: [["pandas", "numpy"]],
    total: 0.55,
    ...over,
  };
}

describe("BreakdownBar", () => {
  it("exports the documented default weights", () => {
    expect(DEFAULT_WEIGHTS).toEqual({
      semantic: 0.4,
      skill_overlap: 0.4,
      experience: 0.1,
      education: 0.1,
    });
  });

  it("computes contributions as signal * weight that sum to total within 1e-3", () => {
    const b = bd();
    const c = contributions(b);
    expect(c.map((x) => x.value)).toEqual([0.2, 0.2, 0.1, 0.05].map((v) => expect.closeTo(v, 6)));
    const sum = c.reduce((a, x) => a + x.value, 0);
    expect(Math.abs(sum - b.total)).toBeLessThan(1e-3);
  });

  it("renders segments, legend, aria summary and no custom-weights note", () => {
    render(<BreakdownBar breakdown={bd()} />);
    expect(screen.getByRole("img", { name: /Semantic 0\.20.*Skills 0\.20.*Experience 0\.10.*Education 0\.05.*total 0\.55/i })).toBeInTheDocument();
    const legend = screen.getByRole("list", { name: "Legend" });
    for (const n of ["Semantic", "Skills", "Experience", "Education"]) {
      expect(within(legend).getByText(n)).toBeInTheDocument();
    }
    expect(screen.queryByText(/custom weights were used/i)).toBeNull();
  });

  it("shows an inline note when the sum differs from total by more than 0.01", () => {
    render(<BreakdownBar breakdown={bd({ total: 0.7 })} />);
    expect(screen.getByText(/custom weights were used/i)).toBeInTheDocument();
    // nothing is rescaled: the segment still shows the raw product
    expect(screen.getByRole("img", { name: /Semantic 0\.20/ })).toBeInTheDocument();
  });

  it("tolerates a sum within 0.01 of total without a note", () => {
    render(<BreakdownBar breakdown={bd({ total: 0.555 })} />);
    expect(screen.queryByText(/custom weights were used/i)).toBeNull();
  });

  it("shows a per-segment tooltip on focus", async () => {
    const user = userEvent.setup();
    render(<BreakdownBar breakdown={bd()} />);
    await user.tab(); // chart toggle buttons come first
    await user.tab();
    await user.tab();
    const seg = screen.getByRole("button", { name: /Semantic: 0\.20/ });
    seg.focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("0.20");
    expect(screen.getByRole("tooltip")).toHaveTextContent(/signal 0\.50 x weight 0\.4/);
  });

  it("table view lists signal, weight and contribution", async () => {
    const user = userEvent.setup();
    render(<BreakdownBar breakdown={bd()} />);
    await user.click(screen.getByRole("button", { name: "Table" }));
    const t = screen.getByRole("table");
    expect(within(t).getByText("Semantic")).toBeInTheDocument();
    expect(within(t).getAllByText("0.20").length).toBeGreaterThan(0);
    expect(within(t).getByText("0.05")).toBeInTheDocument();
  });

  it("renders matched and related skills as plain text chips", () => {
    const b = bd({
      matched_skills: ["<img src=x onerror=alert(1)>", "python"],
      related_skills: [["pandas", "numpy"]],
    });
    const { container } = render(<BreakdownBar breakdown={b} />);
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("pandas ~ numpy")).toBeInTheDocument();
  });

  it("truncates a very long skill with the full text in a title", () => {
    const long = "x".repeat(300);
    render(<BreakdownBar breakdown={bd({ matched_skills: [long] })} />);
    const chip = screen.getByTitle(long);
    expect(chip.textContent!.length).toBeLessThan(long.length);
  });

  it("works on the fixture breakdown from the API fixtures", () => {
    const a = makeAllocation();
    render(<BreakdownBar breakdown={a.breakdown as unknown as ScoreBreakdown} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it.each([
    ["NaN", { semantic: NaN }],
    ["negative", { education: -0.2 }],
    ["above 1", { experience: 1.5 }],
    ["Infinity total", { total: Infinity }],
  ])("renders the inline error panel for %s", (_n, bad) => {
    render(<BreakdownBar breakdown={bd(bad)} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("draws nothing for a zero contribution and never emits NaN", () => {
    const { container } = render(
      <BreakdownBar breakdown={bd({ semantic: 0, skill_overlap: 0, experience: 0, education: 0, total: 0 })} />,
    );
    expect(container.textContent).not.toMatch(/NaN/);
    expect(screen.queryAllByRole("button", { name: /: 0\.00/ })).toHaveLength(0);
  });
});
