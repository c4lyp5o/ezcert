// Fixed-window, in-memory rate limiter. Per process: with PM2 cluster mode each worker
// counts separately, so the effective limit is `limit × workers`.
const CLEANUP_THRESHOLD = 10_000;

export function createRateLimiter(limit: number, windowMs: number) {
	const hits = new Map<string, { count: number; resetAt: number }>();

	return function allow(key: string): boolean {
		const now = Date.now();
		if (hits.size > CLEANUP_THRESHOLD) {
			for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
		}

		const entry = hits.get(key);
		if (!entry || entry.resetAt <= now) {
			hits.set(key, { count: 1, resetAt: now + windowMs });
			return true;
		}
		if (entry.count >= limit) return false;
		hits.set(key, { count: entry.count + 1, resetAt: entry.resetAt });
		return true;
	};
}
