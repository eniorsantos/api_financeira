import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Ativos from "./pages/Ativos";
import Avaliacao from "./pages/Avaliacao";
import Carteira from "./pages/Carteira";
import Dashboard from "./pages/Dashboard";
import Layout from "./pages/Layout";
import Relatorios from "./pages/Relatorios";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="ativos" element={<Ativos />} />
            <Route path="carteira" element={<Carteira />} />
            <Route path="relatorios" element={<Relatorios />} />
            <Route path="avaliacao" element={<Avaliacao />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
