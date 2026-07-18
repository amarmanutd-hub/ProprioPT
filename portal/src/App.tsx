import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { RequirePt } from "./auth/RequirePt";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { LoginPage } from "./pages/LoginPage";
import { MfaPage } from "./pages/MfaPage";
import { PatientActivatePage } from "./pages/PatientActivatePage";
import { PatientHomePage } from "./pages/PatientHomePage";
import { TherapistDashboard } from "./pages/TherapistDashboard";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/mfa" element={<MfaPage />} />
        <Route path="/activate" element={<PatientActivatePage />} />
        <Route path="/patient" element={<PatientHomePage />} />
        <Route element={<RequirePt />}>
          <Route path="/" element={<TherapistDashboard />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
