import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { adminLogin } from "../lib/auth";

export default function Login() {
  const navigate            = useNavigate();
  const [email,   setEmail] = useState("");
  const [pass,    setPass]  = useState("");
  const [error,   setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const err = await adminLogin(email, pass);
    if (err) {
      setError(err);
      setLoading(false);
    } else {
      navigate("/");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-maroon-900 via-maroon-800 to-maroon-700 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3 text-gold-400">◆</div>
          <h1 className="text-white font-bold text-xl tracking-tight">Lord Gold Check</h1>
          <p className="text-maroon-100/60 text-sm mt-1">Admin</p>
        </div>

        <div className="bg-maroon-800/80 rounded-2xl border border-maroon-600/50 p-8 shadow-2xl backdrop-blur">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-maroon-100/70 uppercase tracking-wider mb-1.5">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-maroon-900 border border-maroon-600 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-maroon-100/30 focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent transition"
                placeholder="admin@example.com"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-maroon-100/70 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                className="w-full bg-maroon-900 border border-maroon-600 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-maroon-100/30 focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent transition"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gold-500 hover:bg-gold-400 text-maroon-900 font-semibold py-2.5 rounded-lg transition disabled:opacity-50 shadow-lg shadow-black/30 text-sm mt-2"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
