import type { PageLoad } from "./$types";
import { superSession, initSuperSession } from "#lib/superAuth.svelte.js";
import { redirect } from "@sveltejs/kit";

export const ssr = false;

interface Tenant {
	id: string;
	name: string;
	email: string;
	status: string;
	createdAt: string;
}

interface BoundSoul extends Tenant {
	conjurations: number; // Event count
}

export const load: PageLoad = async ({ fetch }) => {
	await initSuperSession();

	if (!superSession.isAuthenticated) throw redirect(302, "/");

	try {
		const [pendingRes, soulsRes] = await Promise.all([
			fetch("/api/v1/superadmin/pending", { credentials: "include" }),
			fetch("/api/v1/superadmin/souls", { credentials: "include" }),
		]);

		if (!pendingRes.ok || !soulsRes.ok) {
			console.error("Failed to fetch altar data", {
				pendingStatus: pendingRes.status,
				soulsStatus: soulsRes.status,
			});
			return { pendingTenants: [], boundSouls: [] };
		}

		const pendingTenants: Tenant[] = await pendingRes.json();
		const boundSouls: BoundSoul[] = await soulsRes.json();

		return { pendingTenants, boundSouls };
	} catch (err) {
		console.error("Error fetching altar data:", err);
		return { pendingTenants: [], boundSouls: [] };
	}
};
