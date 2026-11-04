/**
 * Pagination (public props, kept stable; reused by Task 6):
 *  - page: current page, 1-based
 *  - pageCount?: total pages; when omitted the total is unknown (server paging) and "Page N" is shown
 *  - hasNext?: only used when pageCount is omitted; enables "Next page"
 *  - onPageChange(page): called with the new 1-based page
 * The page is clamped into 1..pageCount for display.
 */
export interface PaginationProps {
  page: number;
  pageCount?: number;
  hasNext?: boolean;
  onPageChange: (page: number) => void;
}

const btn =
  "min-h-11 rounded border border-slate-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50";

export function Pagination({ page, pageCount, hasNext, onPageChange }: PaginationProps) {
  const current = pageCount !== undefined ? Math.min(Math.max(1, page), Math.max(1, pageCount)) : Math.max(1, page);
  const canNext = pageCount !== undefined ? current < pageCount : Boolean(hasNext);
  return (
    <nav aria-label="Pagination" className="mt-3 flex items-center justify-between gap-2">
      <button type="button" className={btn} aria-label="Previous page" disabled={current <= 1} onClick={() => onPageChange(current - 1)}>
        Previous
      </button>
      <span aria-live="polite" className="text-sm">
        {pageCount !== undefined ? `Page ${current} of ${Math.max(1, pageCount)}` : `Page ${current}`}
      </span>
      <button type="button" className={btn} aria-label="Next page" disabled={!canNext} onClick={() => onPageChange(current + 1)}>
        Next
      </button>
    </nav>
  );
}
