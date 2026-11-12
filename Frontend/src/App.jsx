import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Login from "./Login";
import SystemAdministratorDashboard from "./SystemAdministratorDashboard";
import SuperAdminDashboard from "./SuperAdminDashboard";
import EventOrganizerDashboard from "./EventOrganizerDashboard";
import UserDashboard from "./user/UserDashboard";

function RoleRoute({ roles, children }) {
  const activeRole = window.sessionStorage.getItem("loginRole")?.toLowerCase();
  const hasSession = Boolean(window.sessionStorage.getItem("accessToken"));
  if (!hasSession || !roles.includes(activeRole)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route
          path="/admin"
          element={
            <RoleRoute roles={["system administrator", "admin"]}>
              <SystemAdministratorDashboard />
            </RoleRoute>
          }
        />
        <Route
          path="/super-admin"
          element={
            <RoleRoute roles={["super admin"]}>
              <SuperAdminDashboard />
            </RoleRoute>
          }
        />
        <Route
          path="/event-organizer"
          element={
            <RoleRoute roles={["event organizer"]}>
              <EventOrganizerDashboard />
            </RoleRoute>
          }
        />
        <Route
          path="/user"
          element={
            <RoleRoute roles={["user", "users"]}>
              <UserDashboard />
            </RoleRoute>
          }
        />
      </Routes>
      
    </BrowserRouter>
  );
}

export default App;