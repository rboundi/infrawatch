import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Network, Table2, Share2, ArrowRight } from "lucide-react";
import { useHostConnections, useDependencyMap } from "../api/hooks";
import { TableSkeleton } from "../components/Skeleton";
import { timeAgo } from "../components/timeago";
import type { DependencyMapData } from "../api/types";

type ViewMode = "table" | "graph";

export function DependenciesPage() {
  const [view, setView] = useState<ViewMode>("table");
  const [search, setSearch] = useState("");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Network className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Dependency Map
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView("table")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
              view === "table"
                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            }`}
          >
            <Table2 className="h-4 w-4" />
            Table
          </button>
          <button
            onClick={() => setView("graph")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
              view === "graph"
                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            }`}
          >
            <Share2 className="h-4 w-4" />
            Graph
          </button>
        </div>
      </div>

      {view === "table" ? (
        <ConnectionsTable search={search} onSearchChange={setSearch} />
      ) : (
        <DependencyGraph />
      )}
    </div>
  );
}

// ─── Table View ───

function ConnectionsTable({
  search,
  onSearchChange,
}: {
  search: string;
  onSearchChange: (v: string) => void;
}) {
  const [page, setPage] = useState(0);
  const limit = 50;
  const { data, isLoading } = useHostConnections({ limit, offset: page * limit });

  const filtered = data?.data.filter((c) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      c.source_hostname?.toLowerCase().includes(s) ||
      c.target_hostname?.toLowerCase().includes(s) ||
      c.target_ip?.toLowerCase().includes(s) ||
      c.source_process?.toLowerCase().includes(s) ||
      c.target_service?.toLowerCase().includes(s)
    );
  });

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <input
          type="text"
          placeholder="Filter connections..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
        {data && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {data.total} total connections
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="p-4">
          <TableSkeleton rows={8} />
        </div>
      ) : filtered && filtered.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="px-4 py-2">Source</th>
                  <th className="px-4 py-2"></th>
                  <th className="px-4 py-2">Target</th>
                  <th className="px-4 py-2">Port</th>
                  <th className="px-4 py-2">Service</th>
                  <th className="px-4 py-2">Process</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.map((c) => (
                  <tr key={c.id} className="text-gray-700 dark:text-gray-300">
                    <td className="px-4 py-2.5 font-medium">
                      <Link to={`/hosts/${c.source_host_id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                        {c.source_hostname}
                      </Link>
                    </td>
                    <td className="px-2 py-2.5">
                      <ArrowRight className="h-3.5 w-3.5 text-gray-400" />
                    </td>
                    <td className="px-4 py-2.5 font-medium">
                      {c.target_host_id ? (
                        <Link to={`/hosts/${c.target_host_id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                          {c.target_hostname ?? c.target_ip}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs text-gray-500">{c.target_ip}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{c.target_port}</td>
                    <td className="px-4 py-2.5 text-xs">{c.target_service ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs">{c.source_process ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        c.connection_type === "observed"
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                      }`}>
                        {c.connection_type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                      {timeAgo(c.last_seen_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && data.total > limit && (
            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 dark:border-gray-700">
              <span className="text-xs text-gray-500">
                Page {page + 1} of {Math.ceil(data.total / limit)}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={(page + 1) * limit >= data.total}
                  className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="px-4 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          No connections observed yet. Connections are collected during SSH scans.
        </div>
      )}
    </div>
  );
}

// ─── Graph View (D3 force simulation) ───

interface SimNode {
  id: string;
  hostname: string;
  ip: string | null;
  os: string | null;
  status: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface SimEdge {
  source: string;
  target: string;
  targetPort: number;
  targetService: string | null;
}

function DependencyGraph() {
  const { data, isLoading } = useDependencyMap();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);
  const hoveredNodeRef = useRef<SimNode | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<SimEdge[]>([]);
  const animRef = useRef<number>(0);

  const initSimulation = useCallback((mapData: DependencyMapData) => {
    const w = canvasRef.current?.parentElement?.clientWidth ?? 800;
    const h = 500;

    const nodes: SimNode[] = mapData.nodes.map((n, i) => ({
      ...n,
      x: w / 2 + Math.cos((i / mapData.nodes.length) * Math.PI * 2) * 200,
      y: h / 2 + Math.sin((i / mapData.nodes.length) * Math.PI * 2) * 200,
      vx: 0,
      vy: 0,
    }));

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const edges: SimEdge[] = mapData.edges
      .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        targetPort: e.targetPort,
        targetService: e.targetService,
      }));

    nodesRef.current = nodes;
    edgesRef.current = edges;

    if (canvasRef.current) {
      canvasRef.current.width = w;
      canvasRef.current.height = h;
    }

    // Simple force simulation
    let tick = 0;
    const maxTicks = 300;

    const simulate = () => {
      if (tick > maxTicks) {
        draw(w, h);
        return;
      }
      tick++;

      const alpha = 1 - tick / maxTicks;
      const nodeArr = nodesRef.current;
      const nodeIdx = new Map(nodeArr.map((n, i) => [n.id, i]));

      // Repulsion
      for (let i = 0; i < nodeArr.length; i++) {
        for (let j = i + 1; j < nodeArr.length; j++) {
          const dx = nodeArr[j].x - nodeArr[i].x;
          const dy = nodeArr[j].y - nodeArr[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (alpha * 5000) / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          nodeArr[i].vx -= fx;
          nodeArr[i].vy -= fy;
          nodeArr[j].vx += fx;
          nodeArr[j].vy += fy;
        }
      }

      // Attraction along edges
      for (const edge of edgesRef.current) {
        const si = nodeIdx.get(edge.source);
        const ti = nodeIdx.get(edge.target);
        if (si === undefined || ti === undefined) continue;
        const dx = nodeArr[ti].x - nodeArr[si].x;
        const dy = nodeArr[ti].y - nodeArr[si].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = alpha * (dist - 150) * 0.01;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        nodeArr[si].vx += fx;
        nodeArr[si].vy += fy;
        nodeArr[ti].vx -= fx;
        nodeArr[ti].vy -= fy;
      }

      // Center gravity
      for (const node of nodeArr) {
        node.vx += (w / 2 - node.x) * alpha * 0.01;
        node.vy += (h / 2 - node.y) * alpha * 0.01;
      }

      // Apply velocity
      for (const node of nodeArr) {
        node.vx *= 0.6;
        node.vy *= 0.6;
        node.x += node.vx;
        node.y += node.vy;
        node.x = Math.max(30, Math.min(w - 30, node.x));
        node.y = Math.max(30, Math.min(h - 30, node.y));
      }

      draw(w, h);
      animRef.current = requestAnimationFrame(simulate);
    };

    cancelAnimationFrame(animRef.current);
    simulate();
  }, []);

  const draw = (w: number, h: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const isDark = document.documentElement.classList.contains("dark");
    ctx.clearRect(0, 0, w, h);

    const nodeMap = new Map(nodesRef.current.map((n) => [n.id, n]));

    // Draw edges
    ctx.strokeStyle = isDark ? "rgba(100,116,139,0.4)" : "rgba(156,163,175,0.5)";
    ctx.lineWidth = 1;
    for (const edge of edgesRef.current) {
      const s = nodeMap.get(edge.source);
      const t = nodeMap.get(edge.target);
      if (!s || !t) continue;

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();

      // Arrow
      const angle = Math.atan2(t.y - s.y, t.x - s.x);
      const arrowLen = 8;
      const mx = (s.x + t.x) / 2;
      const my = (s.y + t.y) / 2;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx - arrowLen * Math.cos(angle - 0.4), my - arrowLen * Math.sin(angle - 0.4));
      ctx.moveTo(mx, my);
      ctx.lineTo(mx - arrowLen * Math.cos(angle + 0.4), my - arrowLen * Math.sin(angle + 0.4));
      ctx.stroke();
    }

    // Draw nodes
    for (const node of nodesRef.current) {
      const isHovered = hoveredNodeRef.current?.id === node.id;
      const radius = isHovered ? 10 : 7;

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = node.status === "active"
        ? (isDark ? "#818cf8" : "#6366f1")
        : (isDark ? "#f87171" : "#ef4444");
      ctx.fill();
      ctx.strokeStyle = isDark ? "#1e293b" : "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillStyle = isDark ? "#e2e8f0" : "#374151";
      ctx.textAlign = "center";
      ctx.fillText(node.hostname, node.x, node.y + radius + 14);
    }
  };

  useEffect(() => {
    if (data && data.nodes.length > 0) {
      initSimulation(data);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [data, initSimulation]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let found: SimNode | null = null;
    for (const node of nodesRef.current) {
      const dx = node.x - mx;
      const dy = node.y - my;
      if (dx * dx + dy * dy < 144) {
        found = node;
        break;
      }
    }
    hoveredNodeRef.current = found;
    setHoveredNode(found);
    // Redraw immediately so the hover highlight appears
    const w = canvas.width;
    const h = canvas.height;
    if (w && h) draw(w, h);
  }, []);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 dark:border-gray-700 dark:bg-gray-800">
        <TableSkeleton rows={5} />
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-12 text-center dark:border-gray-700 dark:bg-gray-800">
        <Network className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          No dependency data available. Connections are collected during SSH scans.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Network Graph
        </h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {data.nodes.length} hosts, {data.edges.length} connections
        </span>
      </div>
      <div className="relative p-2">
        <canvas
          ref={canvasRef}
          className="w-full cursor-crosshair"
          style={{ height: 500 }}
          onMouseMove={handleMouseMove}
        />
        {hoveredNode && (
          <div className="pointer-events-none absolute left-4 top-4 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-gray-600 dark:bg-gray-700">
            <p className="font-semibold text-gray-900 dark:text-gray-100">{hoveredNode.hostname}</p>
            {hoveredNode.ip && <p className="text-gray-500 dark:text-gray-400">{hoveredNode.ip}</p>}
            {hoveredNode.os && <p className="text-gray-500 dark:text-gray-400">{hoveredNode.os}</p>}
            <p className={hoveredNode.status === "active" ? "text-green-600" : "text-red-600"}>
              {hoveredNode.status}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
