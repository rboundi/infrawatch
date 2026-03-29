import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Users,
  AlertTriangle,
  Shield,
  Pencil,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { useGroups, useDeleteGroup } from "../api/hooks";
import type { HostGroup } from "../api/types";
import { GroupFormModal } from "../components/GroupFormModal";

export function GroupsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useGroups();
  const deleteGroup = useDeleteGroup();
  const [showForm, setShowForm] = useState(false);
  const [editGroup, setEditGroup] = useState<HostGroup | null>(null);

  const groups = data?.data ?? [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Groups
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {groups.length} group{groups.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => { setEditGroup(null); setShowForm(true); }}
          className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" /> Create Group
        </button>
      </div>

      {isLoading ? (
        <div className="text-center text-gray-500 dark:text-gray-400 py-12">Loading...</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <Users className="mx-auto h-12 w-12 mb-3 opacity-40" />
          <p className="text-lg font-medium">No groups yet</p>
          <p className="mt-1 text-sm">Create a group to organize hosts and route alerts.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              onClick={() => navigate(`/groups/${g.id}`)}
              onEdit={(e) => { e.stopPropagation(); setEditGroup(g); setShowForm(true); }}
              onDelete={(e) => {
                e.stopPropagation();
                if (confirm(`Delete group "${g.name}"?`)) deleteGroup.mutate(g.id);
              }}
            />
          ))}
        </div>
      )}

      {showForm && (
        <GroupFormModal
          group={editGroup}
          onClose={() => { setShowForm(false); setEditGroup(null); }}
        />
      )}
    </div>
  );
}

function GroupCard({
  group,
  onClick,
  onEdit,
  onDelete,
}: {
  group: HostGroup;
  onClick: () => void;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const totalAlerts = group.criticalAlerts + group.highAlerts + group.mediumAlerts + group.lowAlerts;

  return (
    <div
      onClick={onClick}
      className="relative cursor-pointer rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
    >
      {/* Color stripe */}
      <div
        className="absolute left-0 top-0 h-full w-1 rounded-l-lg"
        style={{ backgroundColor: group.color || "#6366f1" }}
      />

      <div className="ml-2">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {group.name}
            </h3>
            {group.description && (
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                {group.description}
              </p>
            )}
          </div>
          <div className="flex gap-1">
            <button onClick={onEdit} className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button onClick={onDelete} className="rounded p-1 text-gray-400 hover:text-red-500" title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Owner */}
        {group.ownerName && (
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            Owner: {group.ownerName}
          </p>
        )}

        {/* Stats */}
        <div className="mt-3 flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
            <Users className="h-3.5 w-3.5" />
            {group.memberCount} host{group.memberCount !== 1 ? "s" : ""}
            {group.staleHosts > 0 && (
              <span className="text-yellow-500">({group.staleHosts} stale)</span>
            )}
          </span>
          <span className="flex items-center gap-1 text-gray-600 dark:text-gray-300">
            <Shield className="h-3.5 w-3.5" />
            {group.ruleCount} rule{group.ruleCount !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Alert severity mini-bar */}
        {totalAlerts > 0 && (
          <div className="mt-3">
            <div className="flex items-center gap-1.5 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
              <span className="text-gray-600 dark:text-gray-300">{totalAlerts} open alert{totalAlerts !== 1 ? "s" : ""}</span>
            </div>
            <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
              {group.criticalAlerts > 0 && (
                <div className="bg-red-500" style={{ width: `${(group.criticalAlerts / totalAlerts) * 100}%` }} />
              )}
              {group.highAlerts > 0 && (
                <div className="bg-orange-500" style={{ width: `${(group.highAlerts / totalAlerts) * 100}%` }} />
              )}
              {group.mediumAlerts > 0 && (
                <div className="bg-yellow-500" style={{ width: `${(group.mediumAlerts / totalAlerts) * 100}%` }} />
              )}
              {group.lowAlerts > 0 && (
                <div className="bg-blue-400" style={{ width: `${(group.lowAlerts / totalAlerts) * 100}%` }} />
              )}
            </div>
          </div>
        )}

        {/* Arrow */}
        <div className="mt-3 flex justify-end">
          <ChevronRight className="h-4 w-4 text-gray-400" />
        </div>
      </div>
    </div>
  );
}
