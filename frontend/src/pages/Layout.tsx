import { Link, Outlet, useLocation } from "react-router-dom";

const links = [
  { to: "/", label: "Dashboard" },
  { to: "/ativos", label: "Ativos" },
  { to: "/carteira", label: "Carteira" },
  { to: "/relatorios", label: "Relatórios" },
  { to: "/avaliacao", label: "Avaliação" },
];

export default function Layout() {
  const loc = useLocation();
  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <nav
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 24,
          borderBottom: "1px solid #e5e7eb",
          paddingBottom: 12,
        }}
      >
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            style={{
              fontWeight: loc.pathname === l.to ? 700 : 400,
              color: "#1d4ed8",
              textDecoration: "none",
            }}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
