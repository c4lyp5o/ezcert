<script lang="ts">
  import { goto } from "$app/navigation";
  import { errorMessage, importedDraft } from "#lib/designs.svelte.js";

  let { data } = $props();
  let designs = $derived(data.designs);

  let importing = $state(false);
  let error = $state("");
  let fileInput: HTMLInputElement;

  async function importPptx(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Reset now: after a successful import we navigate away and the input is gone
    input.value = "";
    if (!file) return;
    importing = true;
    error = "";

    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/v1/admin/designs/import", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        error = await errorMessage(res, "Import failed");
        return;
      }
      importedDraft.value = await res.json();
      await goto("/admin/designs/new");
    } finally {
      importing = false;
    }
  }

  async function deleteDesign(design: { id: string; name: string }) {
    if (
      !confirm(
        `Delete "${design.name}"? Events using it will fall back to their built-in template.`,
      )
    )
      return;
    const res = await fetch(`/api/v1/admin/designs/${design.id}`, {
      method: "DELETE",
    });
    if (res.ok) designs = designs.filter((d) => d.id !== design.id);
    else alert(await errorMessage(res, "Failed to delete design"));
  }
</script>

<div class="min-h-screen bg-black text-zinc-300 font-sans pb-20">
  <div class="max-w-5xl mx-auto px-6 pt-10">
    <a href="/admin" class="text-xs text-zinc-500 hover:text-white"
      >← Dashboard</a
    >
    <div
      class="flex flex-col md:flex-row md:items-end justify-between gap-4 mt-4 mb-8"
    >
      <div>
        <h1 class="text-3xl font-bold text-white tracking-tight">
          Certificate Designs
        </h1>
        <p class="text-zinc-500 mt-1 text-sm">
          Build your own certificate, or design it in PowerPoint and import it.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <div
          class="flex items-center rounded-lg border border-zinc-700 text-sm text-zinc-300 overflow-hidden"
        >
          <span class="px-3 text-zinc-500">PPTX template:</span>
          <a
            href="/api/v1/admin/designs/starter.pptx?orientation=landscape"
            class="px-3 py-2 hover:bg-zinc-800">Landscape</a
          >
          <a
            href="/api/v1/admin/designs/starter.pptx?orientation=portrait"
            class="px-3 py-2 hover:bg-zinc-800 border-l border-zinc-700"
            >Portrait</a
          >
        </div>
        <button
          onclick={() => fileInput.click()}
          disabled={importing}
          class="px-4 py-2 rounded-lg text-sm border border-zinc-700 hover:border-zinc-500 text-zinc-300 disabled:opacity-50"
          >{importing ? "Importing..." : "Import PPTX"}</button
        >
        <input
          bind:this={fileInput}
          type="file"
          accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          class="hidden"
          onchange={importPptx}
        />
        <a
          href="/admin/designs/new?orientation=landscape"
          class="bg-white text-black px-4 py-2 rounded-lg text-sm font-semibold hover:bg-zinc-200"
          >+ New landscape</a
        >
        <a
          href="/admin/designs/new?orientation=portrait"
          class="bg-white text-black px-4 py-2 rounded-lg text-sm font-semibold hover:bg-zinc-200"
          >+ New portrait</a
        >
      </div>
    </div>

    {#if error}
      <div
        class="mb-6 p-3 rounded bg-red-900/20 border border-red-900/50 text-red-400 text-sm"
      >
        {error}
      </div>
    {/if}

    <details class="mb-8 text-sm text-zinc-500 bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
      <summary class="cursor-pointer text-zinc-300">How PowerPoint import works</summary>
      <ul class="list-disc pl-5 mt-3 space-y-1">
        <li>
          Download the landscape or portrait template and keep its A4 size. The importer
          detects the orientation automatically.
        </li>
        <li>
          Put placeholders like <code>{"{{attendee_name}}"}</code>,
          <code>{"{{event_name}}"}</code>, <code>{"{{date}}"}</code>,
          <code>{"{{location}}"}</code>, <code>{"{{host_name}}"}</code> and
          <code>{"{{certificate_id}}"}</code> in text boxes. A text box containing only
          <code>{"{{qr}}"}</code> becomes the verification QR code.
        </li>
        <li>Logos and signatures: insert them as pictures. Background: use a solid colour or a picture.</li>
        <li>
          Shapes, lines, gradients, groups and tables are not imported. Put decorations in
          the background picture.
        </li>
        <li>After importing, you can adjust everything in the editor before saving.</li>
      </ul>
    </details>

    <div class="grid gap-3">
      {#each designs as design (design.id)}
        <div
          class="flex items-center justify-between bg-zinc-900/50 border border-zinc-800 rounded-xl px-5 py-4"
        >
          <div>
            <div class="text-white font-medium">{design.name}</div>
            <div class="text-xs text-zinc-500">
              Updated {new Date(design.updatedAt).toLocaleString()}
            </div>
          </div>
          <div class="flex gap-4 text-sm">
            <a href={`/admin/designs/${design.id}`} class="text-blue-400 hover:text-blue-300"
              >Edit</a
            >
            <button
              onclick={() => deleteDesign(design)}
              class="text-zinc-500 hover:text-red-400">Delete</button
            >
          </div>
        </div>
      {:else}
        <div class="text-center text-zinc-500 py-16 border border-dashed border-zinc-800 rounded-xl">
          No designs yet. Create one or import a PowerPoint file.
        </div>
      {/each}
    </div>
  </div>
</div>
