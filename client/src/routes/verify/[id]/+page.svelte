<script lang="ts">
  let { data } = $props();
  let cert = $derived(data.certificate);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
</script>

<svelte:head><title>Verify certificate · EzCert</title></svelte:head>

<div class="min-h-screen bg-black flex items-center justify-center p-4 font-sans text-zinc-200">
  <div class="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl p-8 shadow-2xl">
    {#if cert}
      <div class="flex items-center gap-3 mb-6">
        <div class="h-10 w-10 rounded-full bg-green-900/30 border border-green-900/60 flex items-center justify-center">
          <svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"
            ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg
          >
        </div>
        <div>
          <h1 class="text-lg font-semibold text-white">Certificate verified</h1>
          <p class="text-xs text-zinc-500">Issued by EzCert on behalf of {cert.hostName}</p>
        </div>
      </div>
      <dl class="space-y-3 text-sm">
        <div><dt class="text-xs uppercase tracking-wider text-zinc-500">Awarded to</dt><dd class="text-white text-lg font-semibold">{cert.attendeeName}</dd></div>
        <div><dt class="text-xs uppercase tracking-wider text-zinc-500">Event</dt><dd class="text-white">{cert.eventName}</dd></div>
        <div class="grid grid-cols-2 gap-3">
          <div><dt class="text-xs uppercase tracking-wider text-zinc-500">Date</dt><dd>{formatDate(cert.eventDate)}</dd></div>
          <div><dt class="text-xs uppercase tracking-wider text-zinc-500">Location</dt><dd>{cert.location}</dd></div>
        </div>
        <div><dt class="text-xs uppercase tracking-wider text-zinc-500">Host</dt><dd>{cert.hostName}</dd></div>
        <div><dt class="text-xs uppercase tracking-wider text-zinc-500">Certificate ID</dt><dd class="font-mono text-xs text-zinc-400 break-all">{cert.certificateId}</dd></div>
      </dl>
    {:else}
      <div class="text-center">
        <div class="mx-auto h-12 w-12 rounded-full bg-red-900/20 border border-red-900/50 flex items-center justify-center mb-4">
          <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"
            ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg
          >
        </div>
        <h1 class="text-lg font-semibold text-white">Certificate not found</h1>
        <p class="text-sm text-zinc-500 mt-2">
          No certificate matches ID <span class="font-mono break-all">{data.id}</span>. Check the
          ID or QR code and try again.
        </p>
      </div>
    {/if}
  </div>
</div>
