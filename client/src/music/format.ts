/** Segundos → `m:ss` (`0:00` quando não há valor). */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Bytes → `12,3 MB` (vazio quando o tamanho é desconhecido). */
export function formatSize(bytes: number): string {
  if (!bytes) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
