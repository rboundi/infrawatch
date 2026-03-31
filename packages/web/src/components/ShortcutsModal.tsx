import { X } from "lucide-react";

const SHORTCUTS = [
  {
    section: "Navigation",
    items: [
      { keys: ["g", "d"], label: "Go to Dashboard" },
      { keys: ["g", "h"], label: "Go to Hosts" },
      { keys: ["g", "a"], label: "Go to Alerts" },
      { keys: ["g", "i"], label: "Go to Discovery" },
      { keys: ["g", "s"], label: "Go to Scan Targets" },
      { keys: ["g", "r"], label: "Go to Reports" },
    ],
  },
  {
    section: "Actions",
    items: [
      { keys: ["/"], label: "Focus search" },
      { keys: ["Esc"], label: "Close modal" },
      { keys: ["?"], label: "Show this help" },
    ],
  },
];

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Keyboard Shortcuts
          </h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-5">
          {SHORTCUTS.map((section) => (
            <div key={section.section}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {section.section}
              </p>
              <div className="space-y-2">
                {section.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-300">{item.label}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k, i) => (
                        <span key={i}>
                          {i > 0 && <span className="mx-0.5 text-xs text-gray-400">then</span>}
                          <kbd className="inline-flex items-center rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-xs font-mono font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300">
                            {k}
                          </kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
