import type { PageLoad } from "./$types";
import { session, initSession } from "$lib/auth.svelte";
import { redirect } from "@sveltejs/kit";

export const ssr = false;

export const load: PageLoad = async ({ fetch }) => {
	await initSession();

	if (!session.user) throw redirect(302, "/login");

	try {
		// console.log("Session info", session.user);
		const res = await fetch("/api/v1/admin/events", {
			credentials: "include",
		});

		if (!res.ok) {
			console.error("Failed to fetch events", { status: res.status });
			return { events: [] };
		}

		const events = await res.json();
		return { events };
	} catch (err) {
		console.error("Error fetching events:", err);
		return { events: [] };
	}
};
