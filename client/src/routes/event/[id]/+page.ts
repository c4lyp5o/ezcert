import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch }) => {
	const eventId = params.id;
	const res = await fetch(`/api/v1/events/${eventId}`);
	if (!res.ok) {
		throw new Error("Failed to fetch event");
	}
	const event = await res.json();
	return { event };
};
