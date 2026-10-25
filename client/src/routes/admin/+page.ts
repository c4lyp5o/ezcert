import type { PageLoad } from "./$types";
import { session, initSession } from "$lib/auth.svelte";
import { redirect } from "@sveltejs/kit";

export const ssr = false;

export const load: PageLoad = async ({ fetch }) => {
	await initSession();

	if (!session.user) throw redirect(302, "/login");

	try {
		const [eventsRes, designsRes] = await Promise.all([
			fetch("/api/v1/admin/events", { credentials: "include" }),
			fetch("/api/v1/admin/designs", { credentials: "include" }),
		]);

		if (!eventsRes.ok) {
			console.error("Failed to fetch events", { status: eventsRes.status });
		}
		const events = eventsRes.ok ? await eventsRes.json() : [];
		const designs: { id: string; name: string }[] = designsRes.ok
			? await designsRes.json()
			: [];
		return { events, designs };
	} catch (err) {
		console.error("Error fetching events:", err);
		return { events: [], designs: [] };
	}
};
