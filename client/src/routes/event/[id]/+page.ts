import type { PageLoad } from "./$types";
import { error } from "@sveltejs/kit";

export const load: PageLoad = async ({ params, fetch }) => {
	const res = await fetch(`/api/v1/events/${params.id}`);
	if (!res.ok) {
		throw error(res.status === 404 || res.status === 422 ? 404 : 500, "Event not found");
	}
	const event = await res.json();
	return { event };
};
