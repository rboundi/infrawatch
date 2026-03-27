export function isOlderThan24h(dateStr: string | null | undefined): boolean {
  if (!dateStr) return true;
  return Date.now() - new Date(dateStr).getTime() > 86400 * 1000;
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const WEEK = 604800;
const MONTH = 2592000;
const YEAR = 31536000;

export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "never";

  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);

  if (seconds < 0) return "just now";
  if (seconds < MINUTE) return "just now";
  if (seconds < HOUR) {
    const m = Math.floor(seconds / MINUTE);
    return `${m}m ago`;
  }
  if (seconds < DAY) {
    const h = Math.floor(seconds / HOUR);
    return `${h}h ago`;
  }
  if (seconds < WEEK) {
    const d = Math.floor(seconds / DAY);
    return `${d}d ago`;
  }
  if (seconds < MONTH) {
    const w = Math.floor(seconds / WEEK);
    return `${w}w ago`;
  }
  if (seconds < YEAR) {
    const m = Math.floor(seconds / MONTH);
    return `${m}mo ago`;
  }
  const y = Math.floor(seconds / YEAR);
  return `${y}y ago`;
}
