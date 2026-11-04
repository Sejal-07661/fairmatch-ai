export const MAX_TEXT = 20000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_NAME = 200;
export const ALLOWED_SUFFIXES = [".pdf", ".docx", ".txt"] as const;

export interface ResumeInput {
  name: string;
  text: string;
  file: File | null;
}

export function validateResumeInput({ name, text, file }: ResumeInput): string | null {
  const n = name.trim();
  if (n === "") return "Enter your name.";
  if (name.length > MAX_NAME) return `Name must be at most ${MAX_NAME} characters.`;
  if (name.includes("\u0000")) return "Name contains an invalid character.";
  const hasText = text.trim() !== "";
  if (hasText && file) return "Provide either resume text or a file, not both.";
  if (!hasText && !file) return "Paste your resume text or choose a file.";
  if (hasText) {
    if (text.length > MAX_TEXT) return `Resume text must be at most ${MAX_TEXT} characters.`;
    if (text.includes("\u0000")) return "Resume text contains an invalid character.";
    return null;
  }
  if (file) {
    const dot = file.name.lastIndexOf(".");
    const suffix = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
    if (!(ALLOWED_SUFFIXES as readonly string[]).includes(suffix)) return "File must be a .pdf, .docx or .txt file.";
    if (file.size === 0) return "The file is empty.";
    if (file.size > MAX_FILE_BYTES) return "File must be 5 MiB or smaller.";
  }
  return null;
}

const LABELS = ["None", "Diploma", "Bachelor", "Master", "Doctorate"];

export function educationLabel(level: number): string {
  return Number.isInteger(level) ? (LABELS[level] ?? "Unknown") : "Unknown";
}
