import { educationLabel } from "./validation";

/** Options for the min-education select (levels 0..4). Labels come from validation.ts. */
export const EDUCATION_OPTIONS: { value: number; label: string }[] = [0, 1, 2, 3, 4].map((value) => ({
  value,
  label: educationLabel(value),
}));
