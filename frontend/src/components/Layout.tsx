import {
  Clapperboard,
  History,
  LayoutDashboard,
  ListVideo,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeft,
  PlayCircle,
  ScrollText,
  Settings,
  Sparkles
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../auth/AuthContext";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/strategies", label: "Stratégies", icon: Sparkles },
  { to: "/runs", label: "Runs", icon: PlayCircle },
  { to: "/clips", label: "Clips", icon: ListVideo },
  { to: "/review", label: "Review Queue", icon: ListVideo },
  { to: "/history", label: "Historique", icon: History },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/settings", label: "Paramètres", icon: Settings }
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await logout();
      navigate("/login");
      toast.success("Déconnecté");
    } catch {
      toast.error("Déconnexion impossible");
    }
  }

  const sidebar = (
    <aside
      className={cn(
        "gradient-cinema flex h-full flex-col border-r border-border transition-[width] duration-200",
        collapsed ? "w-[72px]" : "w-56"
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-gold text-primary-foreground">
          <Clapperboard className="h-5 w-5" />
        </div>
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gradient-gold">CineContent</p>
            <p className="truncate text-xs text-muted-foreground">Viral gaming</p>
          </div>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto hidden lg:flex"
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Étendre" : "Réduire"}
        >
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed ? <span>{item.label}</span> : null}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-border p-3">
        {!collapsed ? (
          <p className="mb-2 truncate text-xs text-muted-foreground" title={user?.email ?? ""}>
            {user?.email}
          </p>
        ) : null}
        <Button variant="outline" className="w-full justify-start gap-2" type="button" onClick={handleLogout}>
          <LogOut className="h-4 w-4" />
          {!collapsed ? "Déconnexion" : null}
        </Button>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden lg:block">{sidebar}</div>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Fermer le menu"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-50 h-full w-64 shadow-xl">{sidebar}</div>
        </div>
      ) : null}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3 lg:hidden">
          <Button variant="ghost" size="icon" type="button" onClick={() => setMobileOpen(true)} aria-label="Menu">
            <Menu className="h-5 w-5" />
          </Button>
          <span className="font-semibold text-gradient-gold">CineContent</span>
        </header>
        <div className="flex-1 overflow-auto p-4 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
