import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import ChartsPreview from "./pages/__ChartsPreview";

// Dev-only entry (charts-preview.html). Not part of the production build input.
const el = document.getElementById("root");
if (el && import.meta.env.DEV) {
  createRoot(el).render(
    <StrictMode>
      <ChartsPreview />
    </StrictMode>,
  );
}
