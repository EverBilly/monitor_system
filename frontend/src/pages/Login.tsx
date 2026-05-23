import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Activity, Lock, Mail, UserPlus } from "lucide-react";

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    
    try {
      if (isRegister) {
        if (!tenantName.trim()) {
          throw new Error("El nombre de la organización es requerido");
        }
        await register(email, password, tenantName);
      } else {
        await login(email, password);
      }
      navigate("/dashboard");
    } catch (err: any) {
      // FastAPI puede devolver detail como string (401, 400) o como array de objetos
      // (422 Unprocessable Entity de validación Pydantic). Hay que normalizar a string.
      const detail = err.response?.data?.detail;
      if (!detail) {
        setError(err.message || "Error de autenticación");
      } else if (typeof detail === "string") {
        setError(detail);
      } else if (Array.isArray(detail)) {
        // Errores de validación Pydantic: [{type, loc, msg, input, ctx}, ...]
        setError(detail.map((d: any) => d.msg ?? JSON.stringify(d)).join(" · "));
      } else {
        setError("Error de autenticación");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 mb-4">
            <Activity className="w-8 h-8 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">Monitor System</h1>
          <p className="text-gray-400 mt-1">
            {isRegister ? "Crea tu cuenta" : "Inicia sesión"}
          </p>
        </div>

        {/* Formulario */}
        <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
          {error && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-500/30 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  placeholder="tu@email.com"
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Contraseña
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  placeholder="••••••••"
                  minLength={8}
                  required
                />
              </div>
              {isRegister && (
                <p className="text-xs text-gray-500 mt-1">
                  Mínimo 8 caracteres, con mayúsculas y números
                </p>
              )}
            </div>

            {/* Tenant Name (solo registro) */}
            {isRegister && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Nombre de tu organización
                </label>
                <div className="relative">
                  <UserPlus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    value={tenantName}
                    onChange={(e) => setTenantName(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    placeholder="Mi Empresa"
                    minLength={3}
                    required
                  />
                </div>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 text-white font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Procesando...
                </>
              ) : (
                isRegister ? "Crear cuenta" : "Iniciar sesión"
              )}
            </button>
          </form>

          {/* Toggle login/register */}
          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsRegister(!isRegister);
                setError("");
              }}
              className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              {isRegister 
                ? "¿Ya tienes cuenta? Inicia sesión" 
                : "¿No tienes cuenta? Regístrate"}
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-500 text-xs mt-6">
          © 2026 Monitor System • Seguridad empresarial
        </p>
      </div>
    </div>
  );
}