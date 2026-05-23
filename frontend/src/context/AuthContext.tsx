import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { api } from "../lib/api";

type User = {
  user_id: string;
  email: string;
  tenant_id: string;
  tenant_name: string;
  role: "admin" | "user";
};

type AuthContextType = {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, tenantName: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ⚠️ BUG ORIGINAL: setupAxiosAuth estaba duplicada idéntica dentro de login()
// y register(), y además se volvía a setear Authorization manualmente al final
// de cada función (3 veces en total). Extraída aquí una sola vez.
function setupAxiosAuth(token: string, tenantId: string) {
  api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  api.defaults.headers.common["X-Tenant-ID"] = tenantId;
  localStorage.setItem("monitor_token", token);
  localStorage.setItem("monitor_tenant_id", tenantId);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restaurar sesión guardada al iniciar
  useEffect(() => {
    const savedToken = localStorage.getItem("monitor_token");
    const savedUser = localStorage.getItem("monitor_user");

    if (savedToken && savedUser) {
      try {
        const parsedUser: User = JSON.parse(savedUser);
        setToken(savedToken);
        setUser(parsedUser);
        setupAxiosAuth(savedToken, parsedUser.tenant_id);
      } catch {
        // JSON inválido en localStorage — limpiar
        localStorage.removeItem("monitor_token");
        localStorage.removeItem("monitor_user");
        localStorage.removeItem("monitor_tenant_id");
      }
    }
    setLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const response = await api.post("/auth/login", { email, password });
    const { user: userData, token: tokenData } = response.data;

    setToken(tokenData.access_token);
    setUser(userData);
    localStorage.setItem("monitor_user", JSON.stringify(userData));
    setupAxiosAuth(tokenData.access_token, userData.tenant_id);
  };

  const register = async (email: string, password: string, tenantName: string) => {
    const response = await api.post("/auth/register", { email, password, tenant_name: tenantName });
    const { user: userData, token: tokenData } = response.data;

    setToken(tokenData.access_token);
    setUser(userData);
    localStorage.setItem("monitor_user", JSON.stringify(userData));
    setupAxiosAuth(tokenData.access_token, userData.tenant_id);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("monitor_token");
    localStorage.removeItem("monitor_user");
    localStorage.removeItem("monitor_tenant_id");
    delete api.defaults.headers.common["Authorization"];
    delete api.defaults.headers.common["X-Tenant-ID"];
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        register,
        logout,
        isAuthenticated: !!token,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return context;
}
