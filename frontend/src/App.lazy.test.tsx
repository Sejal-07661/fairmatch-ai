import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { App } from "./App";
import { saveToken } from "./auth/token";
import { makeToken, renderApp } from "./test/render";
import { server } from "./test/server";

it("test_admin_runs_route_shows_loading_then_page", async () => {
  server.use(http.get("/api/runs", () => HttpResponse.json([])));
  saveToken(makeToken({ role: "admin" }));
  renderApp(<App />, { route: "/runs" });
  expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  expect(await screen.findByRole("heading", { level: 1, name: /runs/i })).toBeInTheDocument();
});
