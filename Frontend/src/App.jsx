import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./Login";
import SystemAdministratorDashboard from "./SystemAdministratorDashboard";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route
          path="/admin"
          element={<SystemAdministratorDashboard />}
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;