import { useMemo, useState, type ReactNode } from "react";
import { Pagination } from "./Pagination";

/**
 * DataTable<T> (public props, kept stable; reused by Task 6):
 *  - columns: {key, header, render(row) => ReactNode, sortValue?(row) => string | number}
 *    a column is sortable only when it has sortValue; undefined/NaN sort values go last in both directions
 *  - rows: T[]; pageSize (default 25) for client-side pagination; emptyMessage; getRowId(row)
 * String/number cell output is rendered as plain text, truncated visually with the full text in `title`.
 */
export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  pageSize?: number;
  emptyMessage: string;
  getRowId: (row: T) => string | number;
}

type Dir = "ascending" | "descending";

function missing(v: string | number | undefined): boolean {
  return v === undefined || v === null || (typeof v === "number" && Number.isNaN(v));
}

function compare(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function Cell({ value }: { value: ReactNode }) {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value);
    return (
      <span className="block max-w-[16rem] truncate" title={text}>
        {text}
      </span>
    );
  }
  return <>{value}</>;
}

export function DataTable<T>({ columns, rows, pageSize = 25, emptyMessage, getRowId }: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(null);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    if (!sort || !col?.sortValue) return rows;
    const sv = col.sortValue;
    const sign = sort.dir === "ascending" ? 1 : -1;
    return rows
      .map((row, i) => ({ row, i, v: sv(row) as string | number | undefined }))
      .sort((x, y) => {
        const mx = missing(x.v);
        const my = missing(y.v);
        if (mx || my) return mx && my ? x.i - y.i : mx ? 1 : -1;
        return sign * compare(x.v as string | number, y.v as string | number) || x.i - y.i;
      })
      .map((e) => e.row);
  }, [rows, columns, sort]);

  const size = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(sorted.length / size));
  const current = Math.min(page, pageCount);
  const visible = sorted.slice((current - 1) * size, current * size);

  const toggle = (key: string) => {
    setSort((s) => (s?.key === key && s.dir === "ascending" ? { key, dir: "descending" } : { key, dir: "ascending" }));
    setPage(1);
  };

  if (rows.length === 0) return <p className="mt-3 text-sm text-slate-600">{emptyMessage}</p>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-300">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className="px-2 py-2 font-semibold"
                  aria-sort={c.sortValue ? (sort?.key === c.key ? sort.dir : "none") : undefined}
                >
                  {c.sortValue ? (
                    <button type="button" className="min-h-11 font-semibold" onClick={() => toggle(c.key)}>
                      {c.header}
                      <span aria-hidden="true">{sort?.key === c.key ? (sort.dir === "ascending" ? " ▲" : " ▼") : ""}</span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={getRowId(row)} className="border-b border-slate-200">
                {columns.map((c) => (
                  <td key={c.key} className="px-2 py-2 align-top">
                    <Cell value={c.render(row)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && <Pagination page={current} pageCount={pageCount} onPageChange={setPage} />}
    </div>
  );
}
