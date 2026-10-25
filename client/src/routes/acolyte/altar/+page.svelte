<script lang="ts">
  import { fade, fly, slide } from "svelte/transition";
  import { logoutSuperAdmin } from "$lib/superAuth.svelte";

  let { data } = $props();
  let requests = $derived(data.pendingTenants || []);
  let souls = $derived(data.boundSouls || []);
  let processingId = $state<string | null>(null);

  async function handleDecision(tenant: any, decision: "APPROVE" | "REJECT") {
    processingId = tenant.id;

    const endpoint =
      decision === "APPROVE"
        ? "/api/v1/superadmin/approve"
        : "/api/v1/superadmin/reject";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: tenant.email }),
      });
      if (!res.ok) {
        alert(await res.text());
        return;
      }

      requests = requests.filter((r: any) => r.id !== tenant.id);
      if (decision === "APPROVE") {
        souls = [
          ...souls,
          { ...tenant, status: "AWAITING_ACTIVATION", conjurations: 0 },
        ];
      }
    } finally {
      processingId = null;
    }
  }

  async function vanquishSoul(soul: any) {
    if (
      !confirm(
        `Are you sure you want to VANQUISH ${soul.name}? This cannot be undone.`,
      )
    )
      return;

    processingId = soul.id;
    try {
      const res = await fetch(`/api/v1/superadmin/souls/${soul.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        alert(await res.text());
        return;
      }
      souls = souls.filter((s: any) => s.id !== soul.id);
    } finally {
      processingId = null;
    }
  }

  function handleLogout() {
    logoutSuperAdmin();
  }
</script>

<div
  class="min-h-screen bg-black text-zinc-400 font-serif selection:bg-indigo-500 selection:text-white overflow-hidden relative"
>
  <div class="fixed inset-0 pointer-events-none">
    <div
      class="absolute inset-0 bg-[radial-gradient(circle_at_top,var(--tw-gradient-stops))] from-indigo-900/20 via-black to-black opacity-50"
    ></div>
    <div
      class="absolute bottom-0 left-0 right-0 h-1/3 bg-linear-to-t from-black to-transparent"
    ></div>
  </div>

  <div class="relative z-10 max-w-5xl mx-auto p-8 md:p-12">
    <header
      class="mb-20 flex flex-col items-center justify-center text-center space-y-4"
    >
      <div
        class="w-px h-16 bg-linear-to-b from-transparent via-zinc-700 to-transparent mb-4"
      ></div>

      <h1
        class="text-4xl md:text-5xl text-transparent bg-clip-text bg-linear-to-b from-white to-zinc-600 tracking-widest uppercase font-light"
      >
        The Altar
      </h1>

      <div
        class="flex items-center gap-6 text-[10px] uppercase tracking-[0.3em] text-zinc-600"
      >
        <span>Observer: <span class="text-zinc-400">Oracle</span></span>
        <span>•</span>
        <button
          onclick={handleLogout}
          class="hover:text-red-900 transition-colors duration-500"
        >
          Sever Connection
        </button>
      </div>
    </header>

    <section class="mb-24">
      {#if requests.length === 0}
        <div
          in:fade
          class="flex flex-col items-center justify-center py-32 space-y-6 opacity-50"
        >
          <div
            class="w-16 h-16 rounded-full border border-zinc-800 flex items-center justify-center relative"
          >
            <div
              class="absolute inset-0 rounded-full animate-ping bg-zinc-800/20"
            ></div>
          </div>
          <p class="text-sm tracking-widest uppercase text-zinc-600">
            The void is silent
          </p>
        </div>
      {:else}
        <div
          class="flex items-center justify-between mb-8 border-b border-zinc-900 pb-4"
        >
          <span class="text-xs uppercase tracking-widest text-zinc-600"
            >Spirits Awaiting Entry</span
          >
          <span class="font-mono text-zinc-500 text-xs"
            >count: {requests.length}</span
          >
        </div>

        <div class="space-y-6">
          {#each requests as req (req.id)}
            <div
              out:fly={{ y: -20, duration: 800, opacity: 0 }}
              class="group relative pl-6 pr-4 py-6 border-l border-zinc-800 hover:border-indigo-500/50 hover:bg-zinc-900/10 transition-all duration-700 ease-out"
            >
              <div
                class="absolute left-[-1px] top-0 bottom-0 w-[1px] bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)] opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              ></div>

              <div
                class="flex flex-col md:flex-row md:items-center justify-between gap-6"
              >
                <div class="space-y-1">
                  <h2
                    class="text-xl text-zinc-200 tracking-wide group-hover:text-white transition-colors"
                  >
                    {req.name}
                  </h2>
                  <div
                    class="flex items-center gap-4 text-xs font-sans tracking-wide text-zinc-600 group-hover:text-zinc-500"
                  >
                    <span>{req.email}</span>
                    <span class="w-1 h-1 rounded-full bg-zinc-800"></span>
                    <span>{new Date(req.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div
                  class="flex items-center gap-6 md:gap-8 pt-2 md:pt-0 font-sans text-xs tracking-widest uppercase"
                >
                  {#if processingId === req.id}
                    <span class="text-indigo-400 animate-pulse"
                      >Communing...</span
                    >
                  {:else}
                    <button
                      onclick={() => handleDecision(req, "REJECT")}
                      class="text-zinc-600 hover:text-red-900 transition-colors duration-300 relative group/btn"
                    >
                      <span class="relative z-10">Exile</span>
                    </button>

                    <button
                      onclick={() => handleDecision(req, "APPROVE")}
                      class="text-zinc-400 hover:text-indigo-300 transition-colors duration-300 flex items-center gap-2 group/btn"
                    >
                      <span>Consecrate</span>
                      <span
                        class="opacity-0 -translate-x-2 group-hover/btn:opacity-100 group-hover/btn:translate-x-0 transition-all duration-500"
                        >→</span
                      >
                    </button>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section>
      <div
        class="flex items-center justify-between mb-8 border-b border-zinc-900 pb-4"
      >
        <span class="text-xs uppercase tracking-widest text-zinc-500"
          >Tenants</span
        >
        <span class="font-mono text-zinc-600 text-[10px]"
          >count: {souls.length}</span
        >
      </div>

      {#if souls.length === 0}
        <div
          class="py-12 text-center opacity-30 text-xs tracking-widest uppercase"
        >
          The void is empty
        </div>
      {:else}
        <div class="grid gap-px bg-zinc-900/30 border border-zinc-900">
          <div
            class="grid grid-cols-12 gap-4 p-4 bg-black/50 text-[10px] uppercase tracking-widest text-zinc-600 font-sans border-b border-zinc-900"
          >
            <div class="col-span-4">Tenant Info</div>
            <div class="col-span-3 text-center">Status</div>
            <div class="col-span-3 text-center">Events Created</div>
            <div class="col-span-2 text-right">Actions</div>
          </div>

          {#each souls as soul (soul.id)}
            <div
              out:slide
              class="grid grid-cols-12 gap-4 p-4 items-center bg-black/20 hover:bg-zinc-900/20 transition-colors group border-t border-zinc-900/50"
            >
              <div class="col-span-4">
                <div
                  class="text-zinc-300 group-hover:text-indigo-200 transition-colors"
                >
                  {soul.name}
                </div>
                <div
                  class="text-[10px] text-zinc-600 font-sans tracking-wide mt-0.5"
                >
                  {soul.email}
                </div>
              </div>

              <div class="col-span-3 flex justify-center">
                <span
                  class={`px-2 py-1 text-[9px] uppercase tracking-widest border ${
                    soul.status === "ACTIVE"
                      ? "border-emerald-900 text-emerald-600"
                      : "border-amber-900 text-amber-600"
                  }`}
                >
                  {soul.status === "ACTIVE" ? "Active" : "Pending Approval"}
                </span>
              </div>

              <div class="col-span-3 text-center">
                <span
                  class="font-mono text-zinc-500 text-xs group-hover:text-white transition-colors"
                >
                  {soul.conjurations}
                </span>
              </div>

              <div class="col-span-2 flex justify-end">
                {#if processingId === soul.id}
                  <span class="text-[9px] uppercase text-red-900 animate-pulse"
                    >Vanquishing...</span
                  >
                {:else}
                  <button
                    onclick={() => vanquishSoul(soul)}
                    class="text-[10px] uppercase tracking-widest text-zinc-700 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    Vanquish
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <div
      class="fixed bottom-8 left-1/2 -translate-x-1/2 opacity-20 pointer-events-none"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        class="text-zinc-500 animate-spin-slow"
      >
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
        ></path>
      </svg>
    </div>
  </div>
</div>

<style>
  /* Slow spin for the footer rune */
  .animate-spin-slow {
    animation: spin 10s linear infinite;
  }
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
