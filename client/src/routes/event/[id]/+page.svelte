<script lang="ts">
  import { Label } from "bits-ui";

  let { data } = $props();

  let name = $state("");
  let email = $state("");
  let ic = $state("");
  let certificateId = $state<string | null>(null);
  let loading = $state(false);
  let errorMessage = $state("");

  async function submitAttendance(e: Event) {
    e.preventDefault();
    loading = true;
    errorMessage = "";

    try {
      const res = await fetch("/api/v1/events/attend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          // Only sent when the organiser collects IC (e.g. for CPD)
          ...(data.event.collectIc ? { ic } : {}),
          eventId: data.event.id,
        }),
      });

      // Errors may be JSON ({ message }) or plain text (e.g. 422/429)
      const text = await res.text();
      let result: { success?: boolean; attendeeId?: string; message?: string } | null = null;
      try {
        result = JSON.parse(text);
      } catch {
        result = null;
      }
      if (result?.success && result.attendeeId) {
        certificateId = result.attendeeId;
      } else {
        errorMessage =
          result?.message ??
          (res.ok || !text ? "Check-in failed. Please check your details." : text);
      }
    } catch {
      errorMessage = "Network error. Please try again.";
    } finally {
      loading = false;
    }
  }
</script>

<div
  class="min-h-screen bg-black flex flex-col items-center justify-center p-4 font-sans text-zinc-200"
>
  <div class="w-full max-w-md relative">
    <div
      class="absolute -inset-1 bg-linear-to-r from-blue-600 to-purple-600 rounded-2xl blur opacity-25"
    ></div>

    <div
      class="relative bg-zinc-900 border border-zinc-800 rounded-xl p-8 shadow-2xl"
    >
      <div class="text-center mb-8 border-b border-zinc-800 pb-6">
        <span
          class="text-xs font-bold uppercase tracking-widest text-blue-500 mb-2 block"
        >
          Event Check-In
        </span>
        <h1 class="text-3xl font-bold text-white tracking-tight mb-2">
          {data.event.name}
        </h1>
        <div
          class="flex items-center justify-center gap-2 text-zinc-400 text-sm"
        >
          <span>{new Date(data.event.date).toLocaleDateString()}</span>
          <span>•</span>
          <span>{data.event.location}</span>
        </div>
        {#if data.event.hostName}
          <p class="text-xs text-zinc-500 mt-2">
            Hosted by {data.event.hostName}
          </p>
        {/if}
      </div>

      {#if !data.event.isOpen && !certificateId}
        <div class="text-center py-6 text-zinc-400 text-sm">
          Check-in for this event is currently closed.
        </div>
      {:else if !certificateId}
        {#if errorMessage}
          <div
            class="mb-4 p-3 rounded bg-red-900/20 border border-red-900/50 text-red-400 text-xs text-center"
          >
            {errorMessage}
          </div>
        {/if}
        <form onsubmit={submitAttendance} class="space-y-5">
          <div class="grid gap-2">
            <Label.Root
              class="text-xs font-medium uppercase tracking-wider text-zinc-500"
            >
              Full Name
            </Label.Root>
            <input
              type="text"
              bind:value={name}
              required
              placeholder="e.g. Jane Doe"
              class="flex h-11 w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
            />
          </div>

          <div class="grid gap-2">
            <Label.Root
              class="text-xs font-medium uppercase tracking-wider text-zinc-500"
            >
              Email Address
            </Label.Root>
            <input
              type="email"
              bind:value={email}
              required
              placeholder="jane@example.com"
              class="flex h-11 w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
            />
          </div>

          {#if data.event.collectIc}
            <div class="grid gap-2">
              <label
                for="ic"
                class="text-xs font-medium uppercase tracking-wider text-zinc-500"
              >
                IC Number <span class="normal-case text-zinc-600">(for CPD)</span>
              </label>
              <input
                id="ic"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                bind:value={ic}
                required
                pattern={"[0-9]{6}-?[0-9]{2}-?[0-9]{4}"}
                title="12-digit MyKad number, e.g. 900101-14-5678"
                placeholder="900101-14-5678"
                class="flex h-11 w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
              />
            </div>
          {/if}

          <button
            type="submit"
            disabled={loading}
            class="w-full mt-2 h-11 rounded-md bg-white text-black font-semibold hover:bg-zinc-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {#if loading}
              <span
                class="h-4 w-4 border-2 border-black/30 border-t-black rounded-full animate-spin"
              ></span>
              Checking In...
            {:else}
              Confirm Attendance
            {/if}
          </button>

          <p class="text-[11px] leading-relaxed text-zinc-500">
            <span class="font-semibold text-zinc-400">Your privacy:</span>
            {data.event.hostName ?? "The organiser"} keeps your name, email{data
              .event.collectIc
              ? " and IC number"
              : ""} encrypted, to issue and verify your certificate{data.event
              .collectIc
              ? " and for CPD reporting"
              : ""}. Your IC is never shown on the certificate or its public verification
            page; the verification page shows only your name and the event. Your details are
            kept until the organiser deletes them. Contact {data.event.hostName ??
              "the organiser"} to have them removed.
          </p>
        </form>
      {:else}
        <div class="text-center py-4">
          <div
            class="mx-auto h-16 w-16 bg-green-900/20 rounded-full flex items-center justify-center mb-4 border border-green-900/50"
          >
            <svg
              class="w-8 h-8 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 13l4 4L19 7"
              ></path>
            </svg>
          </div>

          <h3 class="text-xl font-semibold text-white mb-2">
            You're Checked In!
          </h3>
          <p class="text-zinc-500 text-sm mb-8">
            Thank you for attending <b>{data.event.name}</b>. Your certificate
            has been generated.
          </p>

          <a
            href={`/api/v1/events/certificate/${certificateId}`}
            target="_blank"
            class="inline-flex w-full items-center justify-center h-11 rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/20"
          >
            Download Certificate
          </a>
        </div>
      {/if}
    </div>

    <div class="mt-8 text-center">
      <p class="text-xs text-zinc-600">
        Powered by <span class="text-zinc-500 font-semibold">ezcert</span>
      </p>
    </div>
  </div>
</div>
