import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import Dashboard from "./Dashboard";

const makeWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (component: React.ReactNode) => (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>{component}</QueryClientProvider>
    </BrowserRouter>
  );
};

describe("Dashboard", () => {
  it("renderiza o título e os seletores de ativo", () => {
    const wrap = makeWrapper();
    const { getByText, getByRole } = render(wrap(<Dashboard />));
    expect(getByText("Painel de Análise Financeira")).toBeInTheDocument();
    expect(getByRole("button", { name: /Sincronizar brapi/ })).toBeInTheDocument();
    expect(getByRole("button", { name: /Sincronizar macro/ })).toBeInTheDocument();
  });
});
