import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { homeFor } from "./auth/redirect";
import { RequireRole } from "./auth/RequireRole";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Layout from "./components/Layout";
import CandidateDetail from "./pages/CandidateDetail";
import Candidates from "./pages/Candidates";
import Forbidden from "./pages/Forbidden";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import Profile from "./pages/Profile";
import Register from "./pages/Register";

const Opportunities = lazy(() => import("./pages/Opportunities"));
const OpportunityDetail = lazy(() => import("./pages/OpportunityDetail"));
const Runs = lazy(() => import("./pages/Runs"));
const RunDetail = lazy(() => import("./pages/RunDetail"));

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user.role) : "/login"} replace />;
}

const admin = (el: ReactNode) => <RequireRole role="admin">{el}</RequireRole>;

export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
      <Suspense fallback={<p role="status">Loading&hellip;</p>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<Home />} />
        <Route element={<Layout />}>
          <Route path="/profile" element={<RequireRole role="any"><Profile /></RequireRole>} />
          <Route path="/opportunities" element={admin(<Opportunities />)} />
          <Route path="/opportunities/:id" element={admin(<OpportunityDetail />)} />
          <Route path="/candidates" element={admin(<Candidates />)} />
          <Route path="/candidates/:id" element={admin(<CandidateDetail />)} />
          <Route path="/runs" element={admin(<Runs />)} />
          <Route path="/runs/:id" element={admin(<RunDetail />)} />
          <Route path="/forbidden" element={<Forbidden />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      </Suspense>
      </AuthProvider>
    </ErrorBoundary>
  );
}
