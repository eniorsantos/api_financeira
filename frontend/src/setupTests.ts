import "@testing-library/jest-dom";

// jsdom não implementa ResizeObserver (usado pelo Recharts ResponsiveContainer)
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
