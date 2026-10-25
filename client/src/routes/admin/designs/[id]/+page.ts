import type { PageLoad } from "./$types";
import { error, redirect } from "@sveltejs/kit";
import { session, initSession } from "$lib/auth.svelte";
import type { Asset, Layout } from "$lib/designs.svelte";

export const load: PageLoad = async ({ params, fetch }) => {
  await initSession();
  if (!session.user) throw redirect(302, "/login");

  const isNew = params.id === "new";
  const [assetsRes, designRes] = await Promise.all([
    fetch("/api/v1/admin/assets"),
    isNew ? null : fetch(`/api/v1/admin/designs/${params.id}`),
  ]);
  if (designRes && !designRes.ok) throw error(404, "Design not found");

  const assets: Asset[] = assetsRes.ok ? await assetsRes.json() : [];
  const design: { id: string; name: string; layout: Layout } | null = designRes
    ? await designRes.json()
    : null;
  return { assets, design };
};
