import { BrowserRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import Invoices from "./pages/Invoices";
import BankTransactions from "./pages/BankTransactions";

export default function App() {
  return (
    <BrowserRouter>
      <header className="topbar">
        <span className="logo">Mock Accounts</span>
        <nav>
          <NavLink to="/invoices">Invoices</NavLink>
          <NavLink to="/bank">Bank</NavLink>
        </nav>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Navigate to="/invoices" replace />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/bank" element={<BankTransactions />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}