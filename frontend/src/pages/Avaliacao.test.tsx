import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import Avaliacao from "./Avaliacao";

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

describe("Avaliacao", () => {
  it("renderiza o título e os filtros de screener", () => {
    const wrap = makeWrapper();
    const { getByText, getByPlaceholderText } = render(wrap(<Avaliacao />));
    expect(getByText("Avaliação (screener)")).toBeInTheDocument();
    expect(getByPlaceholderText(/P\/L máx/)).toBeInTheDocument();
    expect(getByPlaceholderText(/P\/VP máx/)).toBeInTheDocument();
    expect(getByPlaceholderText(/DY mín %/)).toBeInTheDocument();
    expect(getByPlaceholderText(/ROE mín %/)).toBeInTheDocument();
    expect(getByText("Buscar")).toBeInTheDocument();
  });
});
