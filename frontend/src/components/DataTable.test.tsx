import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable } from "./DataTable";

interface Row {
  id: number;
  name: string;
  n?: number;
}
const cols = [
  { key: "name", header: "Name", render: (r: Row) => r.name, sortValue: (r: Row) => r.name },
  { key: "n", header: "N", render: (r: Row) => String(r.n ?? ""), sortValue: (r: Row) => r.n as number },
];
const mk = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: i, name: `row${String(i).padStart(2, "0")}`, n: i }));
const names = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0]?.textContent);
const table = (rows: Row[], empty = "none") => (
  <DataTable columns={cols} rows={rows} emptyMessage={empty} getRowId={(r) => r.id} />
);

describe("DataTable", () => {
  it("test_sorts_ascending_then_descending_with_aria_sort", async () => {
    render(table([{ id: 1, name: "b" }, { id: 2, name: "a" }, { id: 3, name: "c" }]));
    const th = screen.getByRole("columnheader", { name: /Name/ });
    expect(th).toHaveAttribute("aria-sort", "none");
    await userEvent.click(within(th).getByRole("button"));
    expect(names()).toEqual(["a", "b", "c"]);
    expect(th).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(within(th).getByRole("button"));
    expect(names()).toEqual(["c", "b", "a"]);
    expect(th).toHaveAttribute("aria-sort", "descending");
  });
  it("test_numeric_sort_and_undefined_last", async () => {
    render(table([{ id: 1, name: "x", n: 10 }, { id: 2, name: "y" }, { id: 3, name: "z", n: 9 }]));
    const btn = within(screen.getByRole("columnheader", { name: /^N( |$)/ })).getByRole("button");
    await userEvent.click(btn);
    expect(names()).toEqual(["z", "x", "y"]);
    await userEvent.click(btn);
    expect(names()).toEqual(["x", "z", "y"]);
  });
  it("test_paginates_60_rows_into_3_pages", async () => {
    render(table(mk(60)));
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(names()).toHaveLength(25);
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
    expect(names()).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });
  it("test_clamps_page_when_rows_shrink", async () => {
    const { rerender } = render(table(mk(60)));
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    rerender(table(mk(30)));
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });
  it("test_empty_message", () => {
    render(table([], "Nothing here"));
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });
  it("test_long_text_truncated_with_title_and_html_is_text", () => {
    const long = "x".repeat(5000);
    render(table([{ id: 1, name: long }, { id: 2, name: "<script>alert(1)</script>" }]));
    expect(screen.getByTitle(long)).toHaveClass("truncate");
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });
});
