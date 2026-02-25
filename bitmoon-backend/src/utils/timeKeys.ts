/**
 * Shared time-key helpers used by LeaderboardService and TournamentService.
 * All keys are computed in UTC to ensure consistency across timezones.
 */

export function dayKey(ts: number): string {
    return new Date(ts).toISOString().slice(0, 10);  // 'YYYY-MM-DD'
}

export function monthKey(ts: number): string {
    return new Date(ts).toISOString().slice(0, 7);   // 'YYYY-MM'
}

export function weekKey(ts: number): string {
    const d    = new Date(ts);
    const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(
        ((d.getTime() - jan1.getTime()) / 86_400_000 + jan1.getUTCDay() + 1) / 7,
    );
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
