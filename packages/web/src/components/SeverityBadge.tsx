const styles: Record<string, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  low: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  info: "bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${styles[severity] ?? styles.info}`}
    >
      {severity}
    </span>
  );
}
