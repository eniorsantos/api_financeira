import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import Relatorios from "./Relatorios";

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

describe("Relatorios", () => {
  it("renderiza o título e botão de exportar CSV", () => {
    const wrap = makeWrapper();
    const { getByText } = render(wrap(<Relatorios />));
    expect(getByText("Relatórios")).toBeInTheDocument();
    expect(getByText("Exportar CSV")).toBeInTheDocument();
    expect(getByText("Todas as classes")).toBeInTheDocument();
  });
});
