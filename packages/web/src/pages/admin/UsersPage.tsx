import { useState, useMemo } from "react";
import {
  Search,
  UserPlus,
  ChevronLeft,
  ChevronRight,
  Pencil,
  KeyRound,
  Unlock,
  UserX,
  UserCheck,
  Copy,
  Check,
  AlertTriangle,
  X,
} from "lucide-react";
import {
  useUsers,
  useCreateUser,
  useUpdateUser,
  useResetPassword,
  useUnlockUser,
  useDeactivateUser,
  useActivateUser,
  type User,
  type UserFilters,
  type CreateUserData,
  type UpdateUserData,
} from "../../api/admin-hooks";
import { useToast } from "../../components/Toast";
import { timeAgo } from "../../components/timeago";

// ─── Helpers ───

function RoleBadge({ role }: { role: string }) {
  return role === "admin" ? (
    <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
      Admin
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
      Operator
    </span>
  );
}

function StatusIndicator({ user }: { user: User }) {
  if (!user.isActive) {
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <span className="text-red-600 dark:text-red-400">Inactive</span>
      </span>
    );
  }
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        <span className="text-amber-600 dark:text-amber-400">Locked</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className="h-2 w-2 rounded-full bg-green-500" />
      <span className="text-green-600 dark:text-green-400">Active</span>
    </span>
  );
}

// ─── Modal wrapper ───

function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Copyable password field ───

function CopyablePassword({ password }: { password: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/30">
      <div className="mb-2 flex items-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5" />
        Save this password now, it won't be shown again
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-sm dark:bg-gray-900 dark:text-gray-200">
          {password}
        </code>
        <button
          onClick={() => { navigator.clipboard.writeText(password); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="rounded p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

// ─── Create User Modal ───

function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const createMutation = useCreateUser();
  const [form, setForm] = useState({ username: "", email: "", displayName: "", role: "operator" as "admin" | "operator", password: "", autoGenerate: true });
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);

  function reset() {
    setForm({ username: "", email: "", displayName: "", role: "operator", password: "", autoGenerate: true });
    setGeneratedPassword(null);
  }

  async function handleSubmit() {
    const data: CreateUserData = {
      username: form.username.trim(),
      email: form.email.trim(),
      role: form.role,
    };
    if (form.displayName.trim()) data.displayName = form.displayName.trim();
    if (form.autoGenerate) {
      data.autoGeneratePassword = true;
    } else {
      data.password = form.password;
    }

    try {
      const result = await createMutation.mutateAsync(data);
      if (result.generatedPassword) {
        setGeneratedPassword(result.generatedPassword);
        toast("User created successfully", "success");
      } else {
        toast("User created successfully", "success");
        reset();
        onClose();
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create user", "error");
    }
  }

  function handleClose() {
    reset();
    onClose();
  }

  const canSubmit = form.username.trim() && form.email.trim() && (form.autoGenerate || form.password.length >= 10);

  return (
    <Modal open={open} onClose={handleClose}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Add User</h3>
        <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <X className="h-5 w-5" />
        </button>
      </div>

      {generatedPassword ? (
        <>
          <p className="text-sm text-gray-600 dark:text-gray-300">User <strong>{form.username}</strong> created.</p>
          <CopyablePassword password={generatedPassword} />
          <button onClick={handleClose} className="mt-4 w-full rounded-md bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            Done
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Username *</label>
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email *</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Display Name</label>
            <input
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Role</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "operator" })}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              <option value="operator">Operator</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
            <div className="mt-1 flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <input
                  type="checkbox"
                  checked={form.autoGenerate}
                  onChange={(e) => setForm({ ...form, autoGenerate: e.target.checked, password: "" })}
                  className="rounded border-gray-300"
                />
                Auto-generate
              </label>
            </div>
            {!form.autoGenerate && (
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Min 10 characters"
                className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
            )}
          </div>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || createMutation.isPending}
            className="mt-2 w-full rounded-md bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating..." : "Create User"}
          </button>
        </div>
      )}
    </Modal>
  );
}

// ─── Edit User Modal ───

function EditUserModal({ user, open, onClose }: { user: User | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const updateMutation = useUpdateUser();
  const [form, setForm] = useState({ email: "", displayName: "", role: "operator" as "admin" | "operator", isActive: true });

  // Sync form with user
  useState(() => {
    if (user) {
      setForm({ email: user.email, displayName: user.displayName || "", role: user.role, isActive: user.isActive });
    }
  });

  // Re-sync when user changes
  if (user && form.email !== user.email && !updateMutation.isPending) {
    setForm({ email: user.email, displayName: user.displayName || "", role: user.role, isActive: user.isActive });
  }

  async function handleSave() {
    if (!user) return;
    const data: UpdateUserData = {};
    if (form.email !== user.email) data.email = form.email;
    if (form.displayName !== (user.displayName || "")) data.displayName = form.displayName;
    if (form.role !== user.role) data.role = form.role;
    if (form.isActive !== user.isActive) data.isActive = form.isActive;

    if (Object.keys(data).length === 0) {
      onClose();
      return;
    }

    try {
      await updateMutation.mutateAsync({ id: user.id, data });
      toast("User updated", "success");
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update user", "error");
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Edit User: {user?.username}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
      </div>
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Display Name</label>
          <input
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Role</label>
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "operator" })}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          >
            <option value="operator">Operator</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Active</label>
          <button
            type="button"
            onClick={() => setForm({ ...form, isActive: !form.isActive })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              form.isActive ? "bg-indigo-600" : "bg-gray-300 dark:bg-gray-600"
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.isActive ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="mt-2 w-full rounded-md bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {updateMutation.isPending ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </Modal>
  );
}

// ─── Reset Password Modal ───

function ResetPasswordModal({ user, open, onClose }: { user: User | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const resetMutation = useResetPassword();
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);

  async function handleReset() {
    if (!user) return;
    try {
      const result = await resetMutation.mutateAsync(user.id);
      setGeneratedPassword(result.generatedPassword);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to reset password", "error");
    }
  }

  function handleClose() {
    setGeneratedPassword(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Reset Password</h3>
        <button onClick={handleClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
      </div>

      {generatedPassword ? (
        <>
          <p className="text-sm text-gray-600 dark:text-gray-300">Password for <strong>{user?.username}</strong> has been reset.</p>
          <CopyablePassword password={generatedPassword} />
          <button onClick={handleClose} className="mt-4 w-full rounded-md bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700">Done</button>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            This will generate a new password for <strong>{user?.username}</strong> and force them to change it on next login. All their active sessions will be revoked.
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={handleClose} className="flex-1 rounded-md border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">Cancel</button>
            <button onClick={handleReset} disabled={resetMutation.isPending} className="flex-1 rounded-md bg-amber-600 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
              {resetMutation.isPending ? "Resetting..." : "Reset Password"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ─── Confirm Modal ───

function ConfirmModal({ open, onClose, onConfirm, title, message, confirmText, destructive, loading }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: string; confirmText: string; destructive?: boolean; loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{message}</p>
      <div className="mt-4 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-md border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">Cancel</button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={`flex-1 rounded-md py-2 text-sm font-medium text-white disabled:opacity-50 ${
            destructive ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700"
          }`}
        >
          {loading ? "..." : confirmText}
        </button>
      </div>
    </Modal>
  );
}

// ─── Main page ───

export function UsersPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  const filters = useMemo<UserFilters>(() => {
    const f: UserFilters = { page, limit: 25 };
    if (search) f.search = search;
    if (roleFilter !== "all") f.role = roleFilter;
    if (statusFilter === "active") f.isActive = true;
    if (statusFilter === "inactive") f.isActive = false;
    return f;
  }, [search, roleFilter, statusFilter, page]);

  const { data, isLoading } = useUsers(filters);
  const unlockMutation = useUnlockUser();
  const deactivateMutation = useDeactivateUser();
  const activateMutation = useActivateUser();

  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ user: User; action: "deactivate" | "activate" | "unlock" } | null>(null);

  const users = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  // Filter locked users client-side if statusFilter is "locked"
  const displayUsers = statusFilter === "locked"
    ? users.filter((u) => u.lockedUntil && new Date(u.lockedUntil) > new Date())
    : users;

  function handleConfirmAction() {
    if (!confirmAction) return;
    const { user, action } = confirmAction;

    if (action === "unlock") {
      unlockMutation.mutate(user.id, {
        onSuccess: () => { toast("User unlocked", "success"); setConfirmAction(null); },
        onError: (err) => toast(err.message, "error"),
      });
    } else if (action === "deactivate") {
      deactivateMutation.mutate(user.id, {
        onSuccess: () => { toast("User deactivated", "success"); setConfirmAction(null); },
        onError: (err) => toast(err.message, "error"),
      });
    } else if (action === "activate") {
      activateMutation.mutate(user.id, {
        onSuccess: () => { toast("User activated", "success"); setConfirmAction(null); },
        onError: (err) => toast(err.message, "error"),
      });
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Users</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage user accounts and permissions
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          <UserPlus className="h-4 w-4" />
          Add User
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search users..."
            className="w-full rounded-md border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="all">All Roles</option>
          <option value="admin">Admin</option>
          <option value="operator">Operator</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="locked">Locked</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
        </div>
      ) : displayUsers.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">No users found</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Username</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Display Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Last Login</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800/50">
                {displayUsers.map((user) => {
                  const isLocked = user.lockedUntil && new Date(user.lockedUntil) > new Date();
                  return (
                    <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{user.username}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{user.email}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{user.displayName || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3"><RoleBadge role={user.role} /></td>
                      <td className="whitespace-nowrap px-4 py-3"><StatusIndicator user={user} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {user.lastLoginAt ? timeAgo(user.lastLoginAt) : "Never"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditUser(user)}
                            title="Edit"
                            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setResetUser(user)}
                            title="Reset Password"
                            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                          {isLocked && (
                            <button
                              onClick={() => setConfirmAction({ user, action: "unlock" })}
                              title="Unlock"
                              className="rounded p-1.5 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                            >
                              <Unlock className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {user.isActive ? (
                            <button
                              onClick={() => setConfirmAction({ user, action: "deactivate" })}
                              title="Deactivate"
                              className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                            >
                              <UserX className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => setConfirmAction({ user, action: "activate" })}
                              title="Activate"
                              className="rounded p-1.5 text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20"
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-2 text-sm text-gray-600 dark:text-gray-300">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modals */}
      <CreateUserModal open={showCreate} onClose={() => setShowCreate(false)} />
      <EditUserModal user={editUser} open={!!editUser} onClose={() => setEditUser(null)} />
      <ResetPasswordModal user={resetUser} open={!!resetUser} onClose={() => setResetUser(null)} />
      {confirmAction && (
        <ConfirmModal
          open
          onClose={() => setConfirmAction(null)}
          onConfirm={handleConfirmAction}
          title={
            confirmAction.action === "unlock" ? "Unlock User" :
            confirmAction.action === "deactivate" ? "Deactivate User" : "Activate User"
          }
          message={
            confirmAction.action === "unlock"
              ? `Unlock ${confirmAction.user.username}? This will reset their failed login counter.`
              : confirmAction.action === "deactivate"
              ? `Deactivate ${confirmAction.user.username}? This will immediately revoke all their sessions.`
              : `Activate ${confirmAction.user.username}?`
          }
          confirmText={confirmAction.action === "unlock" ? "Unlock" : confirmAction.action === "deactivate" ? "Deactivate" : "Activate"}
          destructive={confirmAction.action === "deactivate"}
          loading={unlockMutation.isPending || deactivateMutation.isPending || activateMutation.isPending}
        />
      )}
    </div>
  );
}
