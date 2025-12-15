// client/src/lib/auth.svelte.ts
type User = {
	id: string;
	name: string;
	email: string;
} | null;

export const session = $state<{ user: User }>({
	user: null,
});

// Initialize from localStorage (run this in your root layout or on mount)
export async function initSession() {
	try {
		const res = await fetch("/api/v1/auth/admin/me", {
			credentials: "include",
		});

		if (res.ok) {
			const data = await res.json();
			// console.log("User data fetched:", data);
			session.user = data.user;
		} else {
			session.user = null;
		}
	} catch (err) {
		console.error("Error initializing session:", err);
		session.user = null;
	}
}

// Logout Action
export function logoutUser() {
	fetch("/api/v1/auth/logout", {
		method: "POST",
		credentials: "include",
	});
	session.user = null;
	window.location.href = "/login";
}
