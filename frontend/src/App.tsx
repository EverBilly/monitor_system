import { useEffect, useState, useMemo, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from "recharts";
import {
  AlertTriangle, Server, Cpu, MemoryStick, HardDrive,
  Activity, RefreshCw, ChevronDown, CheckCircle, PlayCircle,
  Bell, LogOut, Database, X
} from "lucide-react";
import { metricsApi, api } from "./lib/api";
import { useAuth } from "./context/AuthContext";

// ─── Tipos ────────────────────────────────────────────────────────────────────
type Metric = {
  time: string; machine_id: string; cpu_pct: number; ram_pct: number;
  disk: Array<{ device: string; used_pct: number }>; uptime_hours: number;
  security_events?: string;
};
type Machine = {
  machine_id: string; ip: string | null; last_seen: string; status: "online" | "offline";
};
type Alert = {
  machine_id: string; severity: "low" | "medium" | "high" | "critical";
  rule: string; triggered_at: string;
};
type DebugStatus = {
  metrics_total: number;
  tenants: { id: string; name: string }[];
  machines: { machine_id: string; tenant_id: string; metric_count: number; last_seen: string; avg_cpu: number; avg_ram: number }[];
  recent_metrics: { time: string; machine_id: string; tenant_id: string; cpu_pct: number; ram_pct: number }[];
  dev_credentials?: { email: string; password: string };
  error?: string;
};

const MACHINE_COLORS: Record<string, string> = {
  "WIN-SRV-01": "#10b981",
  "WIN-WKS-01": "#3b82f6",
  "WIN-WKS-02": "#8b5cf6",
  "WIN-DB-01":  "#f59e0b",
};

// ─── Componente principal ─────────────────────────────────────────────────────
export default function App() {
  const { user, logout } = useAuth();

  const [machines,      setMachines]      = useState<Machine[]>([]);
  const [metrics,       setMetrics]       = useState<Metric[]>([]);
  const [alerts,        setAlerts]        = useState<Alert[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<string>("all");
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [demoMode,      setDemoMode]      = useState(false);
  const [hasData,       setHasData]       = useState(false);
  const [lastUpdate,    setLastUpdate]    = useState(new Date());
  const [chartKey,      setChartKey]      = useState(0);
  const [showDebug,     setShowDebug]     = useState(false);
  const [debugData,     setDebugData]     = useState<DebugStatus | null>(null);
  const [debugLoading,  setDebugLoading]  = useState(false);

  // ── Fetch principal ──────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (demoMode) return;
    setLoading(true);
    setError(null);
    try {
      const [machRes, metRes, altRes] = await Promise.all([
        metricsApi.getMachines(),
        metricsApi.getMetrics(selectedMachine === "all" ? undefined : selectedMachine, 50),
        metricsApi.getAlerts(),
      ]);

      if (import.meta.env.DEV) {
        console.log("📥 RAW Response:", {
          machines: machRes.data?.length || 0,
          metrics:  metRes.data?.length  || 0,
          alerts:   altRes.data?.length  || 0,
          firstMetric: metRes.data?.[0],
        });
      }

      setMachines(machRes.data || []);
      setMetrics(metRes.data  || []);
      setAlerts(altRes.data   || []);
      setHasData(true);
      setLastUpdate(new Date());
      setChartKey(k => k + 1);
    } catch (err: any) {
      console.error("Backend error:", err);
      if (!hasData) setError("No se pudo conectar con el backend");
    } finally {
      setLoading(false);
    }
  }, [selectedMachine, demoMode, hasData]);

  // Fetch automático cada 10 s
  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 10_000);
    return () => clearInterval(iv);
  }, [fetchData]);

  // ── Debug DB ─────────────────────────────────────────────────────────────────
  const fetchDebug = async () => {
    setDebugLoading(true);
    try {
      const r = await api.get("/debug/status");
      setDebugData(r.data);
    } catch (e: any) {
      setDebugData({ error: e.message, metrics_total: 0, tenants: [], machines: [], recent_metrics: [] });
    } finally {
      setDebugLoading(false);
    }
  };

  const openDebug = () => {
    setShowDebug(true);
    fetchDebug();
  };

  // ── Modo demo (datos locales sin backend) ─────────────────────────────────
  const activateDemo = () => {
    const now = Date.now();
    const mockMachines: Machine[] = [
      { machine_id: "WIN-SRV-01", ip: "192.168.1.10", last_seen: new Date().toISOString(), status: "online" },
      { machine_id: "WIN-WKS-01", ip: "192.168.1.20", last_seen: new Date().toISOString(), status: "online" },
      { machine_id: "WIN-WKS-02", ip: "192.168.1.21", last_seen: new Date().toISOString(), status: "online" },
      { machine_id: "WIN-DB-01",  ip: "192.168.1.30", last_seen: new Date().toISOString(), status: "online" },
    ];
    const mockMetrics: Metric[] = [];
    mockMachines.forEach(m => {
      const baseCpu = m.machine_id.includes("SRV") ? 35 : m.machine_id.includes("DB") ? 45 : 20;
      const baseRam = m.machine_id.includes("DB")  ? 65 : m.machine_id.includes("SRV") ? 50 : 35;
      for (let i = 0; i < 30; i++) {
        mockMetrics.push({
          time:       new Date(now - (30 - i) * 5_000).toISOString(),
          machine_id: m.machine_id,
          cpu_pct:    Math.min(100, Math.max(5, baseCpu + Math.random() * 40 - 20)),
          ram_pct:    Math.min(100, Math.max(10, baseRam + Math.random() * 30 - 15)),
          disk:       [{ device: "C:", used_pct: 45 + Math.random() * 30 }],
          uptime_hours: 120 + Math.random() * 600,
        });
      }
    });
    setMachines(mockMachines);
    setMetrics(mockMetrics);
    setAlerts([]);
    setDemoMode(true);
    setHasData(true);
    setError(null);
    setChartKey(k => k + 1);
  };

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    const filtered = selectedMachine === "all"
      ? metrics
      : metrics.filter(m => m.machine_id === selectedMachine);

    if (selectedMachine === "all" && machines.length > 0) {
      const BUCKET = 5_000;
      const byTime: Record<number, any> = {};
      filtered.forEach(m => {
        const bucket = Math.floor(new Date(m.time).getTime() / BUCKET) * BUCKET;
        if (!byTime[bucket]) {
          byTime[bucket] = {
            time:      new Date(bucket).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            timestamp: bucket,
          };
        }
        const kCpu = `${m.machine_id}_cpu`;
        const kRam = `${m.machine_id}_ram`;
        if (!byTime[bucket][kCpu]) { byTime[bucket][kCpu] = []; byTime[bucket][kRam] = []; }
        byTime[bucket][kCpu].push(m.cpu_pct);
        byTime[bucket][kRam].push(m.ram_pct);
      });

      return Object.values(byTime)
        .map((e: any) => {
          const avg: any = { time: e.time, timestamp: e.timestamp };
          machines.forEach(m => {
            const ck = `${m.machine_id}_cpu`; const rk = `${m.machine_id}_ram`;
            if (e[ck]?.length) avg[ck] = e[ck].reduce((a: number, b: number) => a + b, 0) / e[ck].length;
            if (e[rk]?.length) avg[rk] = e[rk].reduce((a: number, b: number) => a + b, 0) / e[rk].length;
          });
          return avg;
        })
        .sort((a: any, b: any) => a.timestamp - b.timestamp)
        .slice(-20);
    }

    return filtered.slice(-20).map(m => ({
      time: new Date(m.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      cpu:  m.cpu_pct,
      ram:  m.ram_pct,
    }));
  }, [metrics, selectedMachine, machines, lastUpdate]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const rel = selectedMachine === "all" ? metrics : metrics.filter(m => m.machine_id === selectedMachine);
    if (!rel.length) return { cpu: "0", ram: "0", disk: "0", online: 0 };
    const last = rel[rel.length - 1];
    return {
      cpu:    last?.cpu_pct?.toFixed(1) || "0",
      ram:    last?.ram_pct?.toFixed(1) || "0",
      disk:   last?.disk?.[0]?.used_pct?.toFixed(1) || "0",
      online: machines.filter(m => m.status === "online").length,
    };
  }, [metrics, machines, selectedMachine, lastUpdate]);

  // ── Pantalla vacía ────────────────────────────────────────────────────────
  if (!loading && !hasData && !demoMode) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="bg-gray-800 rounded-2xl p-8 border border-gray-700 shadow-xl">
            <Server size={48} className="mx-auto text-gray-500 mb-4" />
            <h2 className="text-xl font-bold mb-2">Esperando agentes</h2>
            <p className="text-gray-400 mb-2 text-sm">
              Conectado como <span className="text-emerald-400">{user?.email}</span>
            </p>
            <p className="text-gray-500 mb-6 text-xs">
              El mock-agent debería estar enviando datos. Revisa los logs de Docker.
            </p>
            <div className="space-y-3">
              <button onClick={activateDemo} className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg transition">
                <PlayCircle size={16} /> Activar Modo Demo
              </button>
              <button onClick={fetchData} className="w-full flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition">
                <RefreshCw size={16} /> Reintentar
              </button>
              {import.meta.env.DEV && (
                <button onClick={openDebug} className="w-full flex items-center justify-center gap-2 bg-indigo-700 hover:bg-indigo-600 px-4 py-2 rounded-lg transition text-sm">
                  <Database size={16} /> Ver estado de la DB
                </button>
              )}
              <button onClick={logout} className="w-full flex items-center justify-center gap-2 text-gray-400 hover:text-white text-sm transition">
                <LogOut size={14} /> Cerrar sesión
              </button>
            </div>
          </div>
        </div>
        {showDebug && <DebugPanel data={debugData} loading={debugLoading} onClose={() => setShowDebug(false)} onRefresh={fetchDebug} />}
      </div>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 md:p-6">

      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="text-emerald-400" /> Monitor System
          </h1>
          <p className="text-gray-400 text-sm">
            {demoMode ? "🎭 Modo Demo" : "🌍 Producción"} • {machines.length} máquinas
            {user && <span className="ml-2 text-gray-500">· {user.email}</span>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Selector de máquina */}
          <div className="relative">
            <select
              value={selectedMachine}
              onChange={e => setSelectedMachine(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 pr-8 appearance-none focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            >
              <option value="all">📊 Todas las máquinas</option>
              {machines.map(m => (
                <option key={m.machine_id} value={m.machine_id}>
                  {m.machine_id} {m.status === "online" ? "🟢" : "🔴"}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>

          {/* Refresh */}
          <button onClick={fetchData} className="p-2 hover:bg-gray-800 rounded transition" title="Actualizar">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>

          {/* Debug DB (solo en dev) */}
          {import.meta.env.DEV && (
            <button onClick={openDebug} className="p-2 hover:bg-gray-800 rounded transition text-indigo-400" title="Estado de la DB">
              <Database size={16} />
            </button>
          )}

          {/* Demo mode exit */}
          {demoMode && (
            <button onClick={() => { setDemoMode(false); fetchData(); }}
              className="text-xs text-amber-400 hover:underline px-2">
              Salir Demo
            </button>
          )}

          {/* Status */}
          <span className={`px-3 py-1 rounded-full text-xs ${error ? "bg-amber-900/50 text-amber-300" : "bg-emerald-900/50 text-emerald-300"}`}>
            {error ? "⚠️ Offline" : "🟢 En vivo"}
          </span>

          <span className="text-gray-500 text-xs">{lastUpdate.toLocaleTimeString()}</span>

          {/* Logout */}
          <button onClick={logout} className="p-2 hover:bg-gray-800 rounded transition text-gray-400 hover:text-red-400" title="Cerrar sesión">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<Cpu size={18} />} label="CPU" value={`${stats.cpu}%`}
          color={parseFloat(stats.cpu) > 85 ? "red" : parseFloat(stats.cpu) > 70 ? "yellow" : "emerald"} />
        <StatCard icon={<MemoryStick size={18} />} label="RAM" value={`${stats.ram}%`}
          color={parseFloat(stats.ram) > 90 ? "red" : parseFloat(stats.ram) > 75 ? "yellow" : "emerald"} />
        <StatCard icon={<HardDrive size={18} />} label="Disco" value={`${stats.disk}%`} color="blue" />
        <StatCard icon={<Server size={18} />} label="Online" value={`${stats.online}/${machines.length}`} color="purple" />
      </div>

      {/* Gráfico */}
      <div className="bg-gray-800 rounded-lg p-4 mb-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Activity size={18} /> Rendimiento {selectedMachine === "all" ? "(todas)" : `· ${selectedMachine}`}
        </h2>
        {loading && !hasData ? (
          <div className="h-64 flex items-center justify-center text-gray-500">
            <RefreshCw className="animate-spin mr-2" /> Cargando métricas...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300} key={`chart-${chartKey}`}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="time" stroke="#9ca3af" fontSize={11} tickMargin={8} />
              <YAxis stroke="#9ca3af" fontSize={11} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px", fontSize: "12px" }}
                labelStyle={{ color: "#fff" }}
              />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              {selectedMachine === "all"
                ? machines.map(m => (
                    <Line key={`cpu-${m.machine_id}`} type="monotone"
                      dataKey={`${m.machine_id}_cpu`} name={`${m.machine_id} CPU`}
                      stroke={MACHINE_COLORS[m.machine_id] || "#64748b"}
                      strokeWidth={2} dot={false} />
                  ))
                : <>
                    <Line type="monotone" dataKey="cpu" name="CPU %" stroke="#10b981" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="ram" name="RAM %" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  </>
              }
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Máquinas + Alertas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Máquinas */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Server size={18} /> Máquinas Monitoreadas
          </h2>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {machines.length === 0 ? (
              <div className="text-center py-6 text-gray-400">
                <Server className="mx-auto mb-3 text-gray-600" size={32} />
                <p className="text-sm">✅ Conectado al backend</p>
                <p className="text-xs mt-1 text-gray-500">Esperando datos del mock-agent...</p>
              </div>
            ) : machines.map(m => (
              <div key={m.machine_id}
                onClick={() => setSelectedMachine(m.machine_id)}
                className={`p-3 rounded cursor-pointer transition flex items-center justify-between ${
                  selectedMachine === m.machine_id ? "bg-emerald-900/30 ring-1 ring-emerald-500" : "hover:bg-gray-700/50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${m.status === "online" ? "bg-emerald-400" : "bg-red-400"}`} />
                  <div>
                    <p className="font-medium text-sm">{m.machine_id}</p>
                    <p className="text-xs text-gray-400">{m.ip} · {new Date(m.last_seen).toLocaleTimeString()}</p>
                  </div>
                </div>
                {selectedMachine === m.machine_id && <CheckCircle size={16} className="text-emerald-400" />}
              </div>
            ))}
          </div>
        </div>

        {/* Alertas */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Bell size={18} className="text-amber-400" /> Alertas Recientes
          </h2>
          {alerts.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <CheckCircle className="mx-auto mb-2 text-emerald-400" size={32} />
              <p>✅ Sin alertas activas</p>
              <p className="text-xs mt-1">CPU &gt; 85%, RAM &gt; 90% y eventos de seguridad</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {alerts.map((a, i) => (
                <div key={i} className={`p-3 rounded border-l-4 ${
                  a.severity === "critical" ? "bg-red-900/30 border-red-500" :
                  a.severity === "high"     ? "bg-orange-900/30 border-orange-500" :
                  "bg-yellow-900/30 border-yellow-500"
                }`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-sm">{a.rule}</p>
                      <p className="text-xs text-gray-400">{a.machine_id} · {new Date(a.triggered_at).toLocaleTimeString()}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      a.severity === "critical" ? "bg-red-500/20 text-red-300" :
                      a.severity === "high"     ? "bg-orange-500/20 text-orange-300" :
                      "bg-yellow-500/20 text-yellow-300"
                    }`}>{a.severity.toUpperCase()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Panel Debug DB */}
      {showDebug && (
        <DebugPanel data={debugData} loading={debugLoading}
          onClose={() => setShowDebug(false)} onRefresh={fetchDebug} />
      )}
    </div>
  );
}

// ─── Panel Debug DB ───────────────────────────────────────────────────────────
function DebugPanel({ data, loading, onClose, onRefresh }:
  { data: DebugStatus | null; loading: boolean; onClose: () => void; onRefresh: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-end p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between p-4 border-b border-gray-700 sticky top-0 bg-gray-900">
          <h3 className="font-semibold flex items-center gap-2">
            <Database size={16} className="text-indigo-400" /> Estado de la Base de Datos
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={onRefresh} className="p-1 hover:bg-gray-800 rounded text-gray-400" title="Refrescar">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button onClick={onClose} className="p-1 hover:bg-gray-800 rounded text-gray-400">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4 text-sm">
          {loading && !data && (
            <div className="text-center py-8 text-gray-400">
              <RefreshCw className="animate-spin mx-auto mb-2" size={24} />
              Consultando DB...
            </div>
          )}

          {data?.error && (
            <div className="bg-red-900/30 border border-red-700 rounded p-3 text-red-300 text-xs font-mono">
              {data.error}
            </div>
          )}

          {data && !data.error && (
            <>
              {/* Resumen */}
              <div className="bg-gray-800 rounded-lg p-3">
                <p className="text-gray-400 text-xs uppercase mb-2">Resumen</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-2xl font-bold text-emerald-400">{data.metrics_total}</p>
                    <p className="text-xs text-gray-500">métricas totales</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-blue-400">{data.tenants.length}</p>
                    <p className="text-xs text-gray-500">tenants</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-purple-400">{data.machines.length}</p>
                    <p className="text-xs text-gray-500">máquinas</p>
                  </div>
                </div>
              </div>

              {/* Tenants */}
              <div>
                <p className="text-gray-400 text-xs uppercase mb-2">Tenants en DB</p>
                {data.tenants.length === 0 ? (
                  <p className="text-gray-600 text-xs">No hay tenants</p>
                ) : data.tenants.map(t => (
                  <div key={t.id} className="bg-gray-800 rounded p-2 mb-1 font-mono text-xs">
                    <span className="text-indigo-300">{t.name}</span>
                    <span className="text-gray-500 ml-2">{t.id.substring(0, 8)}...</span>
                  </div>
                ))}
              </div>

              {/* Máquinas con métricas */}
              <div>
                <p className="text-gray-400 text-xs uppercase mb-2">Máquinas con datos</p>
                {data.machines.length === 0 ? (
                  <div className="bg-amber-900/20 border border-amber-700/50 rounded p-3 text-xs text-amber-300">
                    ⚠️ Sin datos de máquinas. El mock-agent no ha enviado métricas todavía.
                    <br />Revisa los logs: <code className="bg-black/30 px-1 rounded">docker compose logs mock-agent</code>
                  </div>
                ) : data.machines.map(m => (
                  <div key={m.machine_id} className="bg-gray-800 rounded p-2 mb-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-emerald-300 font-medium">{m.machine_id}</span>
                      <span className="text-gray-500">{m.metric_count} métricas</span>
                    </div>
                    <div className="text-gray-500 mt-0.5 flex gap-3">
                      <span>CPU avg {m.avg_cpu}%</span>
                      <span>RAM avg {m.avg_ram}%</span>
                      <span>tenant: {m.tenant_id.substring(0, 8)}...</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Últimas 10 métricas */}
              {data.recent_metrics.length > 0 && (
                <div>
                  <p className="text-gray-400 text-xs uppercase mb-2">Últimas 10 métricas</p>
                  <div className="bg-gray-800 rounded overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-700">
                          <th className="text-left p-2 text-gray-500">Hora</th>
                          <th className="text-left p-2 text-gray-500">Máquina</th>
                          <th className="text-right p-2 text-gray-500">CPU</th>
                          <th className="text-right p-2 text-gray-500">RAM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recent_metrics.map((r, i) => (
                          <tr key={i} className="border-b border-gray-700/50">
                            <td className="p-2 text-gray-500 font-mono">
                              {new Date(r.time).toLocaleTimeString()}
                            </td>
                            <td className="p-2 text-emerald-300">{r.machine_id}</td>
                            <td className="p-2 text-right">{r.cpu_pct}%</td>
                            <td className="p-2 text-right">{r.ram_pct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Credenciales dev */}
              {data.dev_credentials && (
                <div className="bg-indigo-900/20 border border-indigo-700/50 rounded p-3 text-xs">
                  <p className="text-indigo-300 font-medium mb-1">Credenciales dev</p>
                  <p>Email: <code className="bg-black/30 px-1 rounded">{data.dev_credentials.email}</code></p>
                  <p>Pass:  <code className="bg-black/30 px-1 rounded">{data.dev_credentials.password}</code></p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string;
  color: "emerald" | "yellow" | "red" | "blue" | "purple";
}) {
  const colors = {
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    yellow:  "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
    red:     "bg-red-500/10 text-red-400 border-red-500/30",
    blue:    "bg-blue-500/10 text-blue-400 border-blue-500/30",
    purple:  "bg-purple-500/10 text-purple-400 border-purple-500/30",
  };
  return (
    <div className={`p-4 rounded-lg border ${colors[color]} flex items-center gap-3`}>
      <div className="p-2 rounded bg-white/5">{icon}</div>
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold">{value}</p>
      </div>
    </div>
  );
}
