import { BrowserRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import Invoices from "./pages/Invoices";
import BankTransactions from "./pages/BankTransactions";
import Reconcile from "./pages/Reconcile";
import Verification from "./pages/Verification";
import Results from "./pages/Results";

export default function App() {
  return (
    <BrowserRouter>
      <header className="topbar">
        <span className="logo">Mock Accounts</span>
        <nav>
          <NavLink to="/invoices">Invoices</NavLink>
          <NavLink to="/bank">Bank</NavLink>
          <NavLink to="/reconcile">Reconcile</NavLink>
          <NavLink to="/verify">Verify</NavLink>
          <NavLink to="/results">Results</NavLink>
        </nav>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Navigate to="/invoices" replace />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/reconcile" element={<Reconcile />} />
          <Route path="/bank" element={<BankTransactions />} />
          <Route path="/verify" element={<Verification />} />
          <Route path="/results" element={<Results />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}