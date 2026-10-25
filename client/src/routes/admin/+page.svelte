<script lang="ts">
  import { Label } from "bits-ui";
  import { getLocalTimeZone, today } from "@internationalized/date";
  import encodeQR from "qr";

  import { session, logoutUser } from "$lib/auth.svelte";

  // The API never sends a full IC to the browser; icMasked is "******-**-1234"
  type Attendee = {
    id: string;
    name: string;
    email: string;
    icMasked: string | null;
    createdAt: string;
  };
  type EventRow = {
    id: string;
    name: string;
    date: string;
    location: string;
    template: string;
    designId: string | null;
    isOpen: boolean;
    collectIc: boolean;
    attendees: Attendee[];
  };

  let { data } = $props();

  // Writable derived: resets from load data, but can be reassigned locally
  let events = $derived<EventRow[]>(data.events || []);
  let designs = $derived(data.designs || []);
  let activeTab = $state<"events" | "settings">("events");

  // --- PROFILE FORM (local copy so edits don't leak into the session until saved) ---
  let profile = $state({
    name: session.user?.name ?? "",
    email: session.user?.email ?? "",
  });
  let savingProfile = $state(false);

  // --- MODAL STATES ---
  let showCreateModal = $state(false);
  let showQrModal = $state(false);

  // datetime-local needs "YYYY-MM-DDTHH:mm"
  const blankEvent = () => ({
    name: "",
    location: "",
    date: `${today(getLocalTimeZone()).toString()}T09:00`,
    template: "default",
    designId: null as string | null,
    isOpen: false,
    collectIc: false,
  });

  // --- PARTICIPANTS PANEL ---
  let participantsEventId = $state<string | null>(null);
  let participantsEvent = $derived(
    events.find((e) => e.id === participantsEventId) ?? null,
  );

  const updateEvent = (id: string, patch: Partial<EventRow>) =>
    (events = events.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  async function deleteParticipant(event: EventRow, attendee: Attendee) {
    if (!confirm(`Permanently delete ${attendee.name}'s data? Their certificate link will stop working.`))
      return;
    const res = await fetch(`/api/v1/admin/events/${event.id}/attendees/${attendee.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      updateEvent(event.id, {
        attendees: event.attendees.filter((a) => a.id !== attendee.id),
      });
    } else alert("Failed to delete participant");
  }

  async function deleteAllParticipants(event: EventRow) {
    const typed = prompt(
      `This permanently deletes ALL ${event.attendees.length} participants' data for "${event.name}", and their certificates stop working.\n\nType DELETE to confirm.`,
    );
    if (typed !== "DELETE") return;
    const res = await fetch(`/api/v1/admin/events/${event.id}/attendees`, { method: "DELETE" });
    if (res.ok) updateEvent(event.id, { attendees: [] });
    else alert("Failed to delete participant data");
  }

  async function setCollectIc(event: EventRow, collectIc: boolean) {
    const res = await fetch(`/api/v1/admin/events/${event.id}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collectIc }),
    });
    if (res.ok) updateEvent(event.id, { collectIc });
    else alert("Failed to update setting");
  }
  let newEvent = $state(blankEvent());

  // Certificate choice encoded for a single <select>: "tpl:<templateId>" or "design:<designId>"
  const certificateValue = (event: EventRow) =>
    event.designId ? `design:${event.designId}` : `tpl:${event.template}`;

  async function changeCertificate(event: EventRow, value: string) {
    const [kind, id] = value.split(":");
    const body =
      kind === "design"
        ? { template: event.template, designId: id }
        : { template: id, designId: null };

    const res = await fetch(`/api/v1/admin/events/${event.id}/certificate`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);

    if (res?.ok) {
      const updated = await res.json();
      events = events.map((e) => (e.id === event.id ? { ...e, ...updated } : e));
    } else {
      alert("Failed to change certificate");
      events = [...events]; // re-render the select with the old value
    }
  }
  let creating = $state(false);
  let createError = $state("");

  // --- QR STATE ---
  let activeQrEvent = $state<EventRow | null>(null);
  let activeQrSvg = $state("");

  // --- STATS (Derived) ---
  let totalEvents = $derived(events.length);
  let activeEvents = $derived(events.filter((e) => e.isOpen).length);
  let totalAttendees = $derived(
    events.reduce((sum, e) => sum + (e.attendees?.length ?? 0), 0),
  );

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

  const eventLink = (event: EventRow) =>
    `${window.location.origin}/event/${event.id}`;
  const fileSafe = (name: string) =>
    name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "event";

  function downloadBlob(content: string, type: string, filename: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function createEvent(e: Event) {
    e.preventDefault();
    creating = true;
    createError = "";

    try {
      const res = await fetch("/api/v1/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newEvent,
          // Send an absolute timestamp so the server's timezone doesn't shift it
          date: new Date(newEvent.date).toISOString(),
        }),
      });

      if (!res.ok) {
        createError = "Failed to create event. Check the fields and try again.";
        return;
      }

      const created: EventRow = await res.json();
      events = [created, ...events];
      showCreateModal = false;
      newEvent = blankEvent();
    } finally {
      creating = false;
    }
  }

  async function toggleStatus(event: EventRow) {
    const isOpen = !event.isOpen;
    const setOpen = (value: boolean) =>
      (events = events.map((e) =>
        e.id === event.id ? { ...e, isOpen: value } : e,
      ));

    setOpen(isOpen); // optimistic
    const res = await fetch(`/api/v1/admin/events/status/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isOpen }),
    }).catch(() => null);

    if (!res?.ok) {
      setOpen(!isOpen);
      alert("Failed to update status");
    }
  }

  async function deleteEvent(event: EventRow) {
    const count = event.attendees?.length ?? 0;
    if (
      !confirm(
        `Delete "${event.name}"${count ? ` and its ${count} attendee record(s)` : ""}? This cannot be undone.`,
      )
    )
      return;

    const res = await fetch(`/api/v1/admin/events/${event.id}`, {
      method: "DELETE",
    });

    if (res.ok) {
      events = events.filter((e) => e.id !== event.id);
    } else {
      alert("Failed to delete event");
    }
  }

  async function updateProfile(e: Event) {
    e.preventDefault();
    savingProfile = true;
    try {
      const res = await fetch("/api/v1/admin/tenant", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (res.ok) {
        session.user = await res.json();
        alert("Profile updated successfully");
      } else {
        alert(res.status === 409 ? "That email is already in use" : "Failed to update profile");
      }
    } finally {
      savingProfile = false;
    }
  }

  function openQrModal(event: EventRow) {
    activeQrEvent = event;
    activeQrSvg = encodeQR(eventLink(event), "svg").replace(
      'fill="black"',
      'fill="#2563eb"',
    );
    showQrModal = true;
  }

  function downloadQr(event: EventRow) {
    downloadBlob(
      encodeQR(eventLink(event), "svg"),
      "image/svg+xml",
      `qr-${fileSafe(event.name)}.svg`,
    );
  }

  async function copyLink(event: EventRow) {
    await navigator.clipboard.writeText(eventLink(event));
  }

  // Built server-side (it's the only place the full IC is decrypted for export) and audit-logged
  const exportUrl = (event: EventRow) =>
    `/api/v1/admin/events/${event.id}/attendees.csv`;

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      showCreateModal = false;
      showQrModal = false;
      participantsEventId = null;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="min-h-screen bg-black text-zinc-300 font-sans selection:bg-blue-900 selection:text-white pb-20"
>
  <nav
    class="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-40"
  >
    <div class="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div class="w-6 h-6 bg-blue-600 rounded-lg"></div>
        <span class="font-bold text-white tracking-tight"
          >EzCert <span class="text-zinc-500 font-normal">Business</span></span
        >
      </div>

      <div class="flex items-center gap-6">
        <div class="text-xs text-zinc-500 hidden sm:block">
          Logged in as <span class="text-zinc-300"
            >{session.user?.name || "Admin"}</span
          >
        </div>
        <button
          onclick={logoutUser}
          class="text-xs font-medium text-zinc-400 hover:text-white transition-colors"
        >
          Log Out
        </button>
      </div>
    </div>
  </nav>

  <div class="max-w-7xl mx-auto px-6 pt-10 pb-8">
    <div
      class="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8"
    >
      <div>
        <h1 class="text-3xl font-bold text-white tracking-tight">Dashboard</h1>
        <p class="text-zinc-500 mt-1">Overview of your event performance.</p>
      </div>

      {#if activeTab === "events"}
        <button
          onclick={() => (showCreateModal = true)}
          class="bg-white text-black px-4 py-2 rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors flex items-center gap-2 shadow-[0_0_15px_rgba(255,255,255,0.1)]"
        >
          <span>+</span> Create Event
        </button>
      {/if}
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
      <div class="bg-zinc-900 border border-zinc-800 p-5 rounded-xl">
        <div
          class="text-zinc-500 text-xs uppercase tracking-wider font-medium mb-1"
        >
          Total Events
        </div>
        <div class="text-3xl font-bold text-white">{totalEvents}</div>
      </div>
      <div class="bg-zinc-900 border border-zinc-800 p-5 rounded-xl">
        <div
          class="text-zinc-500 text-xs uppercase tracking-wider font-medium mb-1"
        >
          Active Now
        </div>
        <div class="text-3xl font-bold text-blue-500">{activeEvents}</div>
      </div>
      <div class="bg-zinc-900 border border-zinc-800 p-5 rounded-xl">
        <div
          class="text-zinc-500 text-xs uppercase tracking-wider font-medium mb-1"
        >
          Total Attendees
        </div>
        <div class="text-3xl font-bold text-zinc-200">{totalAttendees}</div>
      </div>
    </div>

    <div class="border-b border-zinc-800 mb-8 flex gap-8">
      <button
        onclick={() => (activeTab = "events")}
        class={`pb-3 text-sm font-medium transition-all relative ${activeTab === "events" ? "text-white" : "text-zinc-500 hover:text-zinc-300"}`}
      >
        Events
        {#if activeTab === "events"}
          <div
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t-full"
          ></div>
        {/if}
      </button>
      <button
        onclick={() => (activeTab = "settings")}
        class={`pb-3 text-sm font-medium transition-all relative ${activeTab === "settings" ? "text-white" : "text-zinc-500 hover:text-zinc-300"}`}
      >
        Company Settings
        {#if activeTab === "settings"}
          <div
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t-full"
          ></div>
        {/if}
      </button>
      <a
        href="/admin/designs"
        class="pb-3 text-sm font-medium text-zinc-500 hover:text-zinc-300"
      >
        Certificate Designs
      </a>
    </div>

    {#if activeTab === "events"}
      <div
        class="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden"
      >
        <table class="w-full text-left text-sm">
          <thead class="bg-zinc-900 text-zinc-500 border-b border-zinc-800">
            <tr>
              <th class="px-6 py-4 font-medium uppercase text-xs tracking-wider"
                >Status</th
              >
              <th class="px-6 py-4 font-medium uppercase text-xs tracking-wider"
                >Event Name</th
              >
              <th class="px-6 py-4 font-medium uppercase text-xs tracking-wider"
                >Date</th
              >
              <th class="px-6 py-4 font-medium uppercase text-xs tracking-wider"
                >Location</th
              >
              <th class="px-6 py-4 font-medium uppercase text-xs tracking-wider"
                >Attendees</th
              >
              <th class="px-6 py-4 font-medium uppercase text-xs tracking-wider"
                >Certificate</th
              >
              <th
                class="px-6 py-4 font-medium uppercase text-xs tracking-wider text-right"
                >Actions</th
              >
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-800">
            {#each events as event (event.id)}
              <tr class="hover:bg-zinc-800/50 transition-colors group">
                <td class="px-6 py-4">
                  <button
                    onclick={() => toggleStatus(event)}
                    class={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide border transition-all ${
                      event.isOpen
                        ? "bg-green-900/20 text-green-500 border-green-900/50 hover:bg-green-900/30"
                        : "bg-zinc-800 text-zinc-500 border-zinc-700 hover:bg-zinc-700"
                    }`}
                  >
                    {event.isOpen ? "Open" : "Closed"}
                  </button>
                </td>
                <td class="px-6 py-4 font-medium text-white">{event.name}</td>
                <td class="px-6 py-4 text-zinc-400">
                  {new Date(event.date).toLocaleDateString()}
                </td>
                <td class="px-6 py-4 text-zinc-400">{event.location}</td>
                <td class="px-6 py-4 text-zinc-400">
                  <button
                    onclick={() => (participantsEventId = event.id)}
                    class="underline decoration-dotted underline-offset-4 hover:text-white"
                    title="View and manage participants"
                  >
                    {event.attendees?.length ?? 0}
                  </button>
                  {#if event.collectIc}
                    <span
                      class="ml-1 rounded bg-amber-900/30 border border-amber-900/50 px-1 text-[10px] text-amber-400"
                      title="Collects IC numbers">IC</span
                    >
                  {/if}
                </td>
                <td class="px-6 py-4">
                  <select
                    value={certificateValue(event)}
                    onchange={(e) =>
                      changeCertificate(event, e.currentTarget.value)}
                    aria-label={`Certificate for ${event.name}`}
                    class="bg-black border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 max-w-40"
                  >
                    <optgroup label="Built-in">
                      {#each templates as tpl (tpl.id)}
                        <option value={`tpl:${tpl.id}`}>{tpl.name}</option>
                      {/each}
                    </optgroup>
                    {#if designs.length}
                      <optgroup label="Your designs">
                        {#each designs as design (design.id)}
                          <option value={`design:${design.id}`}
                            >{design.name}</option
                          >
                        {/each}
                      </optgroup>
                    {/if}
                  </select>
                </td>
                <td
                  class="px-6 py-4 text-right flex items-center justify-end gap-3 opacity-60 group-hover:opacity-100 transition-opacity"
                >
                  <button
                    onclick={() => openQrModal(event)}
                    class="text-zinc-400 hover:text-white"
                    title="QR Code"
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
                  <a
                    href={`/event/${event.id}`}
                    target="_blank"
                    class="text-zinc-400 hover:text-blue-400"
                    title="View Public Page"
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
                    onclick={() => copyLink(event)}
                    class="text-zinc-400 hover:text-white text-xs"
                    title="Copy check-in link">Copy</button
                  >
                  {#if event.attendees?.length}
                    <a
                      href={exportUrl(event)}
                      class="text-zinc-400 hover:text-white text-xs"
                      title={event.collectIc
                        ? "Export attendees incl. IC numbers (CSV, for CPD)"
                        : "Export attendees (CSV)"}>CSV</a
                    >
                  {:else}
                    <span class="text-zinc-400 text-xs opacity-30">CSV</span>
                  {/if}
                  <button
                    onclick={() => deleteEvent(event)}
                    class="text-zinc-500 hover:text-red-400 text-xs"
                    title="Delete event">Delete</button
                  >
                </td>
              </tr>
            {/each}
            {#if events.length === 0}
              <tr
                ><td colspan="7" class="p-8 text-center text-zinc-500"
                  >No events found. Create one to get started.</td
                ></tr
              >
            {/if}
          </tbody>
        </table>
      </div>
    {/if}

    {#if activeTab === "settings"}
      <div class="max-w-xl">
        <div class="bg-zinc-900/50 border border-zinc-800 p-8 rounded-xl">
          <h2 class="text-xl font-bold text-white mb-6">Company Profile</h2>
          <form onsubmit={updateProfile} class="space-y-6">
            <div class="space-y-2">
              <Label.Root
                class="text-xs font-medium uppercase tracking-wider text-zinc-500"
                >Company Name</Label.Root
              >
              <input
                type="text"
                bind:value={profile.name}
                required
                class="w-full bg-black border border-zinc-800 rounded-lg p-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div class="space-y-2">
              <Label.Root
                class="text-xs font-medium uppercase tracking-wider text-zinc-500"
                >Work Email</Label.Root
              >
              <input
                type="email"
                bind:value={profile.email}
                required
                class="w-full bg-black border border-zinc-800 rounded-lg p-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div class="pt-2">
              <button
                type="submit"
                disabled={savingProfile}
                class="bg-white text-black px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {savingProfile ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    {/if}
  </div>

  {#if showCreateModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        class="absolute inset-0 bg-black/80 backdrop-blur-sm"
        role="presentation"
        onclick={() => (showCreateModal = false)}
      ></div>
      <div
        class="relative bg-zinc-900 border border-zinc-800 rounded-xl p-8 max-w-md w-full shadow-2xl"
      >
        <h2 class="text-xl font-bold text-white mb-6">Create New Event</h2>
        <form onsubmit={createEvent} class="space-y-4">
          <div class="space-y-1">
            <Label.Root class="text-xs text-zinc-500">Event Name</Label.Root>
            <input
              type="text"
              bind:value={newEvent.name}
              required
              placeholder="e.g. Q4 Townhall"
              class="w-full bg-black border border-zinc-800 rounded-md p-2 text-white focus:ring-2 focus:ring-blue-600 outline-none"
            />
          </div>
          <div class="space-y-1">
            <Label.Root class="text-xs text-zinc-500">Date</Label.Root>
            <input
              type="datetime-local"
              bind:value={newEvent.date}
              required
              class="w-full bg-black border border-zinc-800 rounded-md p-2 text-white focus:ring-2 focus:ring-blue-600 outline-none"
            />
          </div>
          <div class="space-y-1">
            <Label.Root class="text-xs text-zinc-500">Location</Label.Root>
            <input
              type="text"
              bind:value={newEvent.location}
              required
              placeholder="e.g. Main Auditorium"
              class="w-full bg-black border border-zinc-800 rounded-md p-2 text-white focus:ring-2 focus:ring-blue-600 outline-none"
            />
          </div>
          <div class="space-y-1">
            <Label.Root class="text-xs text-zinc-500"
              >Certificate Template</Label.Root
            >
            <div class="grid grid-cols-2 gap-2">
              {#each templates as tpl (tpl.id)}
                <button
                  type="button"
                  onclick={() => {
                    newEvent.template = tpl.id;
                    newEvent.designId = null;
                  }}
                  class={`flex items-center gap-2 rounded-md border p-2 text-xs text-left transition-colors ${!newEvent.designId && newEvent.template === tpl.id ? "border-blue-600 text-white" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"}`}
                >
                  <span data-theme-lock class={`h-5 w-7 rounded-sm border ${tpl.color}`}></span>
                  {tpl.name}
                </button>
              {/each}
              {#each designs as design (design.id)}
                <button
                  type="button"
                  onclick={() => (newEvent.designId = design.id)}
                  class={`flex items-center gap-2 rounded-md border p-2 text-xs text-left transition-colors ${newEvent.designId === design.id ? "border-blue-600 text-white" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"}`}
                >
                  <span
                    class="h-5 w-7 rounded-sm border border-dashed border-zinc-500"
                  ></span>
                  <span class="truncate">{design.name}</span>
                </button>
              {/each}
            </div>
            <a
              href="/admin/designs"
              class="text-[11px] text-blue-400 hover:text-blue-300"
              >Design your own certificate →</a
            >
          </div>
          <label class="flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" bind:checked={newEvent.isOpen} />
            Open check-in immediately
          </label>
          <label class="flex items-start gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              bind:checked={newEvent.collectIc}
              class="mt-0.5"
            />
            <span>
              Collect IC number (for CPD)
              <span class="block text-[11px] text-zinc-600"
                >Stored encrypted, masked in the dashboard; full IC only in the CSV export.
                Only enable if you need it.</span
              >
            </span>
          </label>
          {#if createError}
            <p class="text-xs text-red-400">{createError}</p>
          {/if}
          <div class="flex gap-3 pt-4">
            <button
              type="button"
              onclick={() => (showCreateModal = false)}
              class="flex-1 py-2 text-zinc-400 hover:text-white">Cancel</button
            >
            <button
              type="submit"
              disabled={creating}
              class="flex-1 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-500 disabled:opacity-50"
              >{creating ? "Creating..." : "Create Event"}</button
            >
          </div>
        </form>
      </div>
    </div>
  {/if}

  {#if participantsEvent}
    {@const pe = participantsEvent}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        class="absolute inset-0 bg-black/80 backdrop-blur-sm"
        role="presentation"
        onclick={() => (participantsEventId = null)}
      ></div>
      <div
        class="relative bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-3xl w-full shadow-2xl max-h-[85vh] flex flex-col"
      >
        <div class="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 class="text-lg font-bold text-white">Participants</h2>
            <p class="text-xs text-zinc-500">
              {pe.name} · {pe.attendees.length} participant(s) · stored encrypted
            </p>
          </div>
          <button
            onclick={() => (participantsEventId = null)}
            class="text-zinc-500 hover:text-white text-sm">Close</button
          >
        </div>

        <label
          class="flex items-center gap-2 text-xs text-zinc-400 mb-4 p-3 rounded-lg bg-black/40 border border-zinc-800"
        >
          <input
            type="checkbox"
            checked={pe.collectIc}
            onchange={(e) => setCollectIc(pe, e.currentTarget.checked)}
          />
          Ask attendees for their IC number (for CPD)
        </label>

        <div class="overflow-auto flex-1 border border-zinc-800 rounded-lg">
          <table class="w-full text-left text-xs">
            <thead class="bg-zinc-900 text-zinc-500 sticky top-0">
              <tr>
                <th class="px-3 py-2 font-medium">Name</th>
                <th class="px-3 py-2 font-medium">Email</th>
                <th class="px-3 py-2 font-medium">IC</th>
                <th class="px-3 py-2 font-medium">Checked in</th>
                <th class="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-800">
              {#each pe.attendees as attendee (attendee.id)}
                <tr>
                  <td class="px-3 py-2 text-white">{attendee.name}</td>
                  <td class="px-3 py-2 text-zinc-400">{attendee.email}</td>
                  <td class="px-3 py-2 font-mono text-zinc-500"
                    >{attendee.icMasked ?? "—"}</td
                  >
                  <td class="px-3 py-2 text-zinc-500"
                    >{new Date(attendee.createdAt).toLocaleString()}</td
                  >
                  <td class="px-3 py-2 text-right">
                    <button
                      onclick={() => deleteParticipant(pe, attendee)}
                      class="text-zinc-500 hover:text-red-400">Delete</button
                    >
                  </td>
                </tr>
              {:else}
                <tr
                  ><td colspan="5" class="px-3 py-8 text-center text-zinc-500"
                    >No participants yet.</td
                  ></tr
                >
              {/each}
            </tbody>
          </table>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 mt-4">
          <button
            onclick={() => deleteAllParticipants(pe)}
            disabled={!pe.attendees.length}
            class="text-xs px-3 py-2 rounded-md border border-red-900/60 text-red-400 hover:bg-red-900/20 disabled:opacity-30"
            >Delete all participant data</button
          >
          {#if pe.attendees.length}
            <a
              href={exportUrl(pe)}
              class="text-xs px-3 py-2 rounded-md bg-white text-black font-semibold hover:bg-zinc-200"
              >Export CSV{pe.collectIc ? " (incl. full IC)" : ""}</a
            >
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if showQrModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        class="absolute inset-0 bg-black/80 backdrop-blur-sm"
        role="presentation"
        onclick={() => (showQrModal = false)}
      ></div>
      <div
        class="relative bg-zinc-900 border border-zinc-700 rounded-xl p-8 max-w-sm w-full shadow-2xl flex flex-col items-center text-center"
      >
        <h3 class="text-xl font-bold text-white mb-1">{activeQrEvent?.name}</h3>
        <p class="text-xs text-zinc-400 mb-6 uppercase tracking-widest">
          Scan to Check-In
        </p>
        <div
          data-theme-lock
          class="bg-white p-4 rounded-lg mb-6 shadow-[0_0_30px_rgba(37,99,235,0.3)]"
        >
          <div class="w-48 h-48">{@html activeQrSvg}</div>
        </div>
        <div class="flex gap-2 w-full">
          <button
            onclick={() => (showQrModal = false)}
            class="flex-1 py-2 bg-zinc-800 text-white rounded-md border border-zinc-700"
            >Close</button
          >
          {#if activeQrEvent}
            {@const qrEvent = activeQrEvent}
            <button
              onclick={() => downloadQr(qrEvent)}
              class="flex-1 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-500"
              >Download</button
            >
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
