/**
 * Format waktu untuk tampilan (frontend §9): timestamp UTC → zona waktu gudang bila diketahui,
 * selain itu zona waktu perangkat. Tanggal kalender (expiry) ditampilkan apa adanya.
 */
export function formatDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone && { timeZone }),
  }).format(d);
}
