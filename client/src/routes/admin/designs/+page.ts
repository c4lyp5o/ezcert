import type { PageLoad } from "./$types";
import { redirect } from "@sveltejs/kit";
import { session, initSession } from "$lib/auth.svelte";

export const load: PageLoad = async ({ fetch }) => {
  await initSession();
  if (!session.user) throw redirect(302, "/login");

  const res = await fetch("/api/v1/admin/designs");
  const designs: { id: string; name: string; updatedAt: string }[] = res.ok
    ? await res.json()
    : [];
  return { designs };
};
