<script lang="ts">
  import { onMount } from "svelte";
  import { Button, Label } from "bits-ui";
  import { getLocalTimeZone, today } from "@internationalized/date";
  import encodeQR from "qr";

  import { session, initSession, logoutUser } from "$lib/auth.svelte";

  onMount(() => {
    initSession();
    if (!session.user) {
      window.location.href = "/login";
    } else {
      isLoading = false;
    }
  });

  let isLoading = $state(true);

  let { data } = $props();

  let events = $derived(data.events || []);
  let template = $state("default");
  let name = $state("");
  let location = $state("");
  let date = $state(today(getLocalTimeZone()).toString());
  let createdLink = $state("");

  let showQrModal = $state(false);
  let activeEventName = $state("");
  let activeQrSvg = $state(""); // We store the SVG string here

  const templates = [
    { id: "default", name: "Minimal", color: "bg-white border-zinc-200" },
    {
      id: "tech-dark",
      name: "Tech Dark",
      color: "bg-zinc-900 border-blue-600",
    },
    {
      id: "elegant-gold",
      name: "Elegant Gold",
      color: "bg-[#fffbeb] border-amber-600",
    },
    {
      id: "retro-pixel",
      name: "Retro Pixel",
      color: "bg-black border-green-500",
    },
  ];

  async function createEvent(e: Event) {
    e.preventDefault();

    const res = await fetch("/api/v1/admin/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        date,
        location,
        template,
        tenantId: session.user?.id,
      }),
    });

    const newEvent = await res.json();

    // Update the link display
    createdLink = `${window.location.origin}/event/${newEvent.id}`;

    // Update the table instantly
    events = [...events, newEvent];

    // Optional: Clear form
    name = "";
    location = "";
  }

  async function openQrModal(event: any) {
    try {
      const link = `${window.location.origin}/event/${event.id}`;
      activeEventName = event.name;

      // 1. Generate SVG using the library
      // 'ecc: M' is Medium error correction (good balance)
      const svgString = encodeQR(link, "svg");

      // 2. Inject the styling into the SVG string manually (The "Zazzz" hack)
      // We replace the default black fill with our brand blue
      activeQrSvg = svgString.replace('fill="black"', 'fill="#2563eb"');

      showQrModal = true;
    } catch (err) {
      console.error(err);
    }
  }

  function downloadQr(event: any) {
    const link = `${window.location.origin}/event/${event.id}`;
    const svgString = encodeQR(link, "svg");

    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `qr-${event.name}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
</script>

{#if isLoading}
  <div class="min-h-screen bg-black text-zinc-300 p-8 font-sans">Loading</div>
{/if}

<div class="min-h-screen bg-black text-zinc-300 p-8 font-sans">
  <header class="mb-8 border-b border-zinc-800 pb-4">
    <h1 class="text-3xl font-bold tracking-tight text-white">
      Admin Dashboard
    </h1>
    <p class="text-zinc-500">Manage your events and attendees.</p>
  </header>

  <Button.Root
    onclick={async () => {
      logoutUser();
      window.location.href = "/login";
    }}
    class="mb-6 h-10 px-6 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium rounded-md transition-colors border border-zinc-700"
  >
    Logout
  </Button.Root>

  <div class="grid grid-cols-1 lg:grid-cols-4 gap-8">
    <div class="lg:col-span-1">
      <div
        class="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 shadow-sm"
      >
        <h2 class="text-xl font-semibold text-white mb-4">Create Event</h2>

        <form onsubmit={createEvent} class="space-y-4">
          <div class="grid gap-2">
            <Label.Root
              class="text-xs font-medium uppercase tracking-wider text-zinc-500"
            >
              Event Name
            </Label.Root>
            <input
              type="text"
              bind:value={name}
              required
              placeholder="e.g. Tech Talk"
              class="flex h-10 w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
            />
          </div>

          <div class="grid gap-2">
            <Label.Root
              class="text-xs font-medium uppercase tracking-wider text-zinc-500"
            >
              Date
            </Label.Root>
            <input
              type="datetime-local"
              bind:value={date}
              required
              class="flex h-10 w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
            />
          </div>

          <div class="grid gap-2">
            <Label.Root
              class="text-xs font-medium uppercase tracking-wider text-zinc-500"
            >
              Location
            </Label.Root>
            <input
              type="text"
              bind:value={location}
              required
              placeholder="e.g. Hall A"
              class="flex h-10 w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
            />
          </div>

          <div class="space-y-3 pt-2">
            <Label.Root
              class="text-xs font-medium uppercase tracking-wider text-zinc-500"
            >
              Certificate Design
            </Label.Root>

            <div class="grid grid-cols-2 gap-3">
              {#each templates as t}
                <button
                  type="button"
                  onclick={() => (template = t.id)}
                  class="relative flex flex-col items-center gap-2 rounded-lg border-2 p-2 transition-all hover:scale-[1.02] focus:outline-none
          {template === t.id
                    ? 'border-blue-500 ring-1 ring-blue-500 bg-zinc-800'
                    : 'border-zinc-800 bg-black'}"
                >
                  <div
                    class={`h-16 w-full rounded ${t.color} flex flex-col items-center justify-center gap-1 shadow-sm`}
                  >
                    <div
                      class="h-1 w-1/2 rounded-full bg-current opacity-20"
                    ></div>
                    <div
                      class="h-1 w-2/3 rounded-full bg-current opacity-40"
                    ></div>
                    {#if t.id === "tech-dark"}
                      <div
                        class="absolute left-2 h-full w-1 bg-blue-600 top-0"
                      ></div>
                    {/if}
                    {#if t.id === "elegant-gold"}
                      <div
                        class="absolute inset-1 border border-amber-600 opacity-50"
                      ></div>
                    {/if}
                    {#if t.id === "retro-pixel"}
                      <span class="text-[0.4rem] text-green-500 font-mono"
                        >>>></span
                      >
                    {/if}
                  </div>
                  <span class="text-[10px] font-medium text-zinc-400"
                    >{t.name}</span
                  >

                  {#if template === t.id}
                    <div
                      class="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-blue-500 text-white flex items-center justify-center"
                    >
                      <svg
                        class="w-3 h-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="3"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                  {/if}
                </button>
              {/each}
            </div>
          </div>

          <button
            type="submit"
            class="mt-2 inline-flex h-10 w-full items-center justify-center rounded-md bg-white text-black font-semibold hover:bg-zinc-200 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 focus:ring-offset-black"
          >
            Create Event
          </button>
        </form>
      </div>
    </div>

    <div class="lg:col-span-3">
      <div
        class="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden"
      >
        <div
          class="px-6 py-4 border-b border-zinc-800 flex justify-between items-center"
        >
          <h2 class="text-xl font-semibold text-white">All Events</h2>
          <span
            class="text-xs bg-zinc-800 text-zinc-400 px-2 py-1 rounded-full"
          >
            Total: {events.length}
          </span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="bg-black/50 text-zinc-400">
              <tr>
                <th
                  class="px-6 py-3 font-medium uppercase text-xs tracking-wider"
                  >Name</th
                >
                <th
                  class="px-6 py-3 font-medium uppercase text-xs tracking-wider"
                  >Date</th
                >
                <th
                  class="px-6 py-3 font-medium uppercase text-xs tracking-wider"
                  >Location</th
                >
                <th
                  class="px-6 py-3 font-medium uppercase text-xs tracking-wider"
                  >Template</th
                >
                <th
                  class="px-6 py-3 font-medium uppercase text-xs tracking-wider text-right"
                  >Action</th
                >
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-800">
              {#each events as event (event.id)}
                <tr class="hover:bg-zinc-800/50 transition-colors">
                  <td class="px-6 py-4 font-medium text-white">{event.name}</td>
                  <td class="px-6 py-4 text-zinc-400">
                    {new Date(event.date).toLocaleDateString()}
                    <span class="text-zinc-600 text-xs ml-1">
                      {new Date(event.date).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </td>
                  <td class="px-6 py-4 text-zinc-400">{event.location}</td>
                  <td class="px-6 py-4 text-zinc-400">{event.template}</td>
                  <td
                    class="px-6 py-4 text-right flex items-center justify-end gap-3"
                  >
                    <a
                      href={`/event/${event.id}`}
                      target="_blank"
                      class="text-zinc-500 hover:text-white transition-colors"
                      title="Open Form"
                    >
                      <svg
                        class="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        ><path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        ></path></svg
                      >
                    </a>

                    <button
                      onclick={() => openQrModal(event)}
                      class="text-blue-400 hover:text-blue-300 font-medium text-xs flex items-center gap-1 transition-colors"
                    >
                      <svg
                        class="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        ><path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M12 4v1m6 11h2m-6 0h-2v4h2v-4zM5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                        ></path></svg
                      >
                      QR
                    </button>

                    <button
                      onclick={() => downloadQr(event)}
                      class="text-zinc-500 hover:text-green-400 transition-colors"
                      title="Download SVG"
                    >
                      <svg
                        class="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        ><path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        ></path></svg
                      >
                    </button>
                  </td>
                </tr>
              {/each}
              {#if events.length === 0}
                <tr>
                  <td colspan="4" class="px-6 py-8 text-center text-zinc-500">
                    No events created yet. Use the form on the left.
                  </td>
                </tr>
              {/if}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  {#if createdLink}
    <div class="mt-6 rounded-md border border-green-900/30 bg-green-900/10 p-4">
      <p class="text-xs font-medium text-green-400 mb-2">Event Created!</p>
      <div class="flex flex-col gap-2">
        <code
          class="break-all rounded bg-black/50 px-2 py-2 text-xs font-mono text-green-300 border border-green-900/50"
        >
          {createdLink}
        </code>
        <button
          class="text-xs font-bold text-green-500 hover:text-green-400 text-left"
          onclick={() => navigator.clipboard.writeText(createdLink)}
        >
          Copy Link
        </button>
      </div>
    </div>
  {/if}

  {#if showQrModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        class="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onclick={() => (showQrModal = false)}
        role="button"
        tabindex="0"
        onkeypress={() => (showQrModal = false)}
      ></div>

      <div
        class="relative bg-zinc-900 border border-zinc-700 rounded-xl p-8 max-w-sm w-full shadow-2xl flex flex-col items-center text-center"
      >
        <h3 class="text-xl font-bold text-white mb-1">{activeEventName}</h3>
        <p class="text-xs text-zinc-400 mb-6 uppercase tracking-widest">
          Scan to Check-In
        </p>

        <div
          class="bg-white p-4 rounded-lg mb-6 shadow-[0_0_30px_rgba(37,99,235,0.3)]"
        >
          <div class="w-48 h-48">
            {@html activeQrSvg}
          </div>
        </div>

        <button
          onclick={() => (showQrModal = false)}
          class="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium rounded-md transition-colors border border-zinc-700"
        >
          Close
        </button>
      </div>
    </div>
  {/if}
</div>
