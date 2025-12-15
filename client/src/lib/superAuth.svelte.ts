// client/src/lib/superAuth.svelte.ts
export const superSession = $state({ isAuthenticated: false });

// Initialize from LocalStorage (run this in your root layout or on mount)
export async function initSuperSession() {
	try {
		const res = await fetch("/api/v1/auth/super/me", {
			credentials: "include",
		});
		if (res.ok) {
			superSession.isAuthenticated = res.ok;
		} else {
			superSession.isAuthenticated = false;
		}
	} catch (err) {
		console.error("Error initializing session:", err);
		superSession.isAuthenticated = false;
	}
}

// Logout Action (Banished from the Altar)
export function logoutSuperAdmin() {
	fetch("/api/v1/superadmin/logout", {
		method: "POST",
		credentials: "include",
	});
	superSession.isAuthenticated = false;
	window.location.href = "/";
}
