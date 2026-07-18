import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export function RequirePt() {
  const { session, profile, mfa, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="page-center muted">Checking session…</div>;
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (mfa?.needsEnrollment || mfa?.needsChallenge) {
    return <Navigate to="/mfa" replace />;
  }

  if (!profile) {
    return <div className="page-center muted">Loading profile…</div>;
  }

  if (profile.role !== "pt") {
    return (
      <div className="page-center">
        <h1>Therapist access only</h1>
        <p className="muted">This portal is restricted to physical therapist accounts.</p>
      </div>
    );
  }

  return <Outlet />;
}
