// Task 6: import StatusBadge from "../components/charts/StatusBadge";  (default export)
import { INK, STATUS } from "./theme";

export type BadgeStatus = "pass" | "fail";

const ICON_PATH: Record<BadgeStatus, string> = {
  // check mark inside a circle
  pass: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-1.2 13.2-3.6-3.6 1.4-1.4 2.2 2.2 4.6-4.6 1.4 1.4-6 6z",
  // cross inside a circle
  fail: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm3.7 11.3-1.4 1.4-2.3-2.3-2.3 2.3-1.4-1.4 2.3-2.3-2.3-2.3 1.4-1.4 2.3 2.3 2.3-2.3 1.4 1.4-2.3 2.3 2.3 2.3z",
};

/** Status is always icon + text; the colour only reinforces it. Text uses an ink token. */
export default function StatusBadge({ status, label }: { status: BadgeStatus; label: string }) {
  const color = status === "pass" ? STATUS.good : STATUS.critical;
  return (
    <span
      data-testid="status-badge"
      data-status={status}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium"
      style={{ borderColor: INK.axis, color: INK.primary }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={ICON_PATH[status]} fill={color} />
      </svg>
      <span>{label}</span>
    </span>
  );
}
