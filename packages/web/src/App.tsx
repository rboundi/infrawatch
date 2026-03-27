import { useEffect, useState } from "react";

interface HealthResponse {
  status: string;
  db: string;
  timestamp: string;
  version: string;
}

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/health")
      .then((res) => res.json())
      .then(setHealth)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
      <div className="bg-gray-900 rounded-xl shadow-lg p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold mb-6">Infrawatch</h1>
        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded p-3 text-red-200">
            Connection failed: {error}
          </div>
        )}
        {health && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Status</span>
              <span
                className={
                  health.status === "healthy"
                    ? "text-green-400"
                    : "text-yellow-400"
                }
              >
                {health.status}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Database</span>
              <span>{health.db}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Version</span>
              <span>{health.version}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Timestamp</span>
              <span>{health.timestamp}</span>
            </div>
          </div>
        )}
        {!health && !error && (
          <p className="text-gray-500">Connecting...</p>
        )}
      </div>
    </div>
  );
}
