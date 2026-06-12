export function formatExtractionRemainingLabel(remainingMs: number, overtime: boolean): string {
  if (overtime) return 'Finishing up…';
  if (remainingMs < 60_000) return 'Less than a minute left';
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes === 1) return 'About 1 min left';
  return `About ${minutes} min left`;
}
