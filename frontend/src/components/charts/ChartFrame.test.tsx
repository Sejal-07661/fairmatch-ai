import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import ChartFrame, { ChartError } from "./ChartFrame";

const table = {
  headers: ["Name", "Value"],
  rows: [
    ["Hungarian", "4.20"],
    ["Gale-Shapley", "4.00"],
  ],
};

function setup(legend = true) {
  return render(
    <ChartFrame
      title="Total score"
      description="Higher is better"
      summary="Bar chart: Hungarian 4.20, Gale-Shapley 4.00"
      table={table}
      legend={
        legend
          ? [
              { key: "hungarian", label: "Hungarian", color: "#2a78d6" },
              { key: "gale_shapley", label: "Gale-Shapley", color: "#eb6834" },
            ]
          : [{ key: "hungarian", label: "Hungarian", color: "#2a78d6" }]
      }
    >
      <svg data-testid="plot" />
    </ChartFrame>,
  );
}

describe("ChartFrame", () => {
  it("shows the chart with an aria-label summary", () => {
    setup();
    expect(screen.getByRole("img", { name: /Hungarian 4.20/ })).toBeInTheDocument();
    expect(screen.getByTestId("plot")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "Chart" })).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles to the table with the keyboard and announces it", async () => {
    const user = userEvent.setup();
    setup();
    await user.tab();
    const chartBtn = screen.getByRole("button", { name: "Chart" });
    expect(chartBtn).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Table" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("4.20")).toBeInTheDocument();
    expect(screen.queryByTestId("plot")).toBeNull();
    expect(screen.getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Showing table view of Total score");
    await user.click(chartBtn);
    expect(screen.getByRole("status")).toHaveTextContent("Showing chart view of Total score");
  });

  it("shows a legend for two or more series only", () => {
    const { unmount } = setup(true);
    expect(screen.getByRole("list", { name: "Legend" })).toBeInTheDocument();
    expect(screen.getByText("Gale-Shapley")).toBeInTheDocument();
    unmount();
    setup(false);
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
  });

  it("renders table cell text as plain text", async () => {
    const user = userEvent.setup();
    render(
      <ChartFrame
        title="T"
        summary="s"
        table={{ headers: ["a"], rows: [["<script>alert(1)</script>"]] }}
      >
        <svg />
      </ChartFrame>,
    );
    await user.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  });
});

describe("ChartError", () => {
  it("renders an alert", () => {
    render(<ChartError title="Total score" message="Value is not a number" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Total score");
    expect(screen.getByRole("alert")).toHaveTextContent("Value is not a number");
  });
});
