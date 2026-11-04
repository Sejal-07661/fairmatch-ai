import { educationLabel, MAX_FILE_BYTES, validateResumeInput } from "./validation";

const f = (name: string, n = 10) => new File([new Uint8Array(n)], name);
const ok = { name: "Ada", text: "python", file: null };

describe("validateResumeInput", () => {
  it("accepts valid text and valid file", () => {
    expect(validateResumeInput(ok)).toBeNull();
    expect(validateResumeInput({ name: "Ada", text: "", file: f("a.pdf") })).toBeNull();
  });
  it("rejects blank or overlong names", () => {
    expect(validateResumeInput({ ...ok, name: "   " })).not.toBeNull();
    expect(validateResumeInput({ ...ok, name: "a".repeat(200) })).toBeNull();
    expect(validateResumeInput({ ...ok, name: "a".repeat(201) })).not.toBeNull();
  });
  it("requires exactly one of text or file", () => {
    expect(validateResumeInput({ ...ok, text: "" })).not.toBeNull();
    expect(validateResumeInput({ ...ok, text: "  ", file: null })).not.toBeNull();
    expect(validateResumeInput({ ...ok, file: f("a.txt") })).not.toBeNull();
  });
  it("enforces text length and NUL", () => {
    expect(validateResumeInput({ ...ok, text: "x".repeat(20000) })).toBeNull();
    expect(validateResumeInput({ ...ok, text: "x".repeat(20001) })).not.toBeNull();
    expect(validateResumeInput({ ...ok, text: "a\u0000b" })).not.toBeNull();
  });
  it("checks the last file suffix case-insensitively", () => {
    for (const n of ["RESUME.PDF", "a.docx", "a.Txt", "a.b.pdf"])
      expect(validateResumeInput({ name: "A", text: "", file: f(n) })).toBeNull();
    for (const n of ["a.pdf.exe", "pdf", "a.doc", ""])
      expect(validateResumeInput({ name: "A", text: "", file: f(n) })).not.toBeNull();
  });
  it("enforces file size 1..5MiB", () => {
    expect(validateResumeInput({ name: "A", text: "", file: f("a.pdf", MAX_FILE_BYTES) })).toBeNull();
    expect(validateResumeInput({ name: "A", text: "", file: f("a.pdf", MAX_FILE_BYTES + 1) })).not.toBeNull();
    expect(validateResumeInput({ name: "A", text: "", file: f("a.pdf", 0) })).not.toBeNull();
  });
});

describe("educationLabel", () => {
  it("maps levels", () => {
    expect([0, 1, 2, 3, 4].map(educationLabel)).toEqual(["None", "Diploma", "Bachelor", "Master", "Doctorate"]);
    expect(educationLabel(7)).toBe("Unknown");
    expect(educationLabel(-1)).toBe("Unknown");
    expect(educationLabel(1.5)).toBe("Unknown");
    expect(educationLabel(NaN)).toBe("Unknown");
  });
});
