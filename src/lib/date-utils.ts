const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatDistanceToNow(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < MINUTE) return "just now";
  if (diff < HOUR) {
    const mins = Math.floor(diff / MINUTE);
    return `${mins}m ago`;
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return `${hours}h ago`;
  }
  if (diff < 30 * DAY) {
    const days = Math.floor(diff / DAY);
    return `${days}d ago`;
  }
  if (diff < 365 * DAY) {
    const months = Math.floor(diff / (30 * DAY));
    return `${months}mo ago`;
  }
  const years = Math.floor(diff / (365 * DAY));
  return `${years}y ago`;
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
