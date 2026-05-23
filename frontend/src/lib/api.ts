import axios from "axios";

// ⚠️ BUG ORIGINAL: URL hardcodeada a "http://localhost:8000/api/v1"
// ignorando VITE_API_URL del .env — peticiones fallaban en Docker/producción.
// CORRECCIÓN: usar la variable de entorno con fallback para desarrollo local.
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

export const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
});

// Interceptor de REQUEST: añadir auth en cada petición
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("monitor_token");
  const tenantId = localStorage.getItem("monitor_tenant_id");

  if (token) {
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  if (tenantId) {
    config.headers["X-Tenant-ID"] = tenantId;
  }

  if (import.meta.env.DEV) {
    console.log("🔐 API Request:", {
      url: config.url,
      hasToken: !!token,
      tenantId: tenantId ? tenantId.substring(0, 8) + "..." : null,
    });
  }

  return config;
});

// Interceptor de RESPONSE: limpiar sesión en 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (import.meta.env.DEV) {
      console.error("❌ API Error:", {
        url: error.config?.url,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
      });
    }

    if (error.response?.status === 401) {
      localStorage.removeItem("monitor_token");
      localStorage.removeItem("monitor_user");
      localStorage.removeItem("monitor_tenant_id");
    }

    return Promise.reject(error);
  }
);

export const metricsApi = {
  get: (endpoint: string, config?: any) => api.get(endpoint, config),
  post: (endpoint: string, data: any) => api.post(endpoint, data),
  sendMetric: (payload: any) => api.post("/metrics", payload),
  getMachines: () => api.get("/machines"),
  getMetrics: (machineId?: string, limit?: number) =>
    api.get("/metrics/latest", { params: { machine_id: machineId, limit } }),
  getAlerts: () => api.get("/alerts"),
};
