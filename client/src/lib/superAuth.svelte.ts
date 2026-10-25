// client/src/lib/superAuth.svelte.ts
export const superSession = $state({ isAuthenticated: false });

// Check the superadmin session cookie
export async function initSuperSession() {
	try {
		const res = await fetch("/api/v1/auth/super/me", {
			credentials: "include",
		});
		superSession.isAuthenticated = res.ok;
	} catch (err) {
		console.error("Error initializing session:", err);
		superSession.isAuthenticated = false;
	}
}

// Logout Action (Banished from the Altar)
export async function logoutSuperAdmin() {
	await fetch("/api/v1/auth/super/logout", {
		method: "POST",
		credentials: "include",
	}).catch(() => {});
	superSession.isAuthenticated = false;
	window.location.href = "/";
}
