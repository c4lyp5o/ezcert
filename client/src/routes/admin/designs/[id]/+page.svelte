<script lang="ts">
  import { goto } from "$app/navigation";
  import { page as appPage } from "$app/state";
  import encodeQR from "qr";
  import {
    FONTS,
    MAX_ELEMENTS,
    PLACEHOLDERS,
    SAMPLE_VALUES,
    assetUrl,
    blankLayout,
    cssFont,
    errorMessage,
    fillSample,
    importedDraft,
    pageSize,
    type Asset,
    type Orientation,
    type DesignElement,
    type Layout,
  } from "#lib/designs.svelte.js";

  let { data } = $props();

  // Initial values come from the saved design, a fresh PPTX import, or a blank layout
  function initialState() {
    if (data.design) {
      return { id: data.design.id, name: data.design.name, layout: data.design.layout, warnings: [] };
    }
    const draft = importedDraft.value;
    importedDraft.value = null;
    if (draft) return { id: null, ...draft };
    // /admin/designs/new?orientation=portrait starts a vertical design
    const orientation: Orientation =
      appPage.url.searchParams.get("orientation") === "portrait" ? "portrait" : "landscape";
    return { id: null, name: "Untitled design", layout: blankLayout(orientation), warnings: [] as string[] };
  }
  const initial = initialState();
  const initialAssets = () => data.assets;

  let designId = $state<string | null>(initial.id);
  let name = $state(initial.name);
  let layout = $state<Layout>(initial.layout);
  let warnings = $state<string[]>(initial.warnings);
  let assets = $state<Asset[]>(initialAssets());

  let selected = $state<number | null>(null);
  let showSample = $state(true);
  let saving = $state(false);
  let uploading = $state(false);
  let uploadKind = $state<Asset["kind"]>("logo");
  let message = $state<{ kind: "error" | "ok"; text: string } | null>(null);

  let canvasWidth = $state(800);
  let pageDims = $derived(pageSize(layout.orientation));
  let isPortrait = $derived(layout.orientation === "portrait");
  let scale = $derived(canvasWidth / pageDims.width);
  let current = $derived(selected === null ? null : layout.elements[selected]);
  let backgroundAsset = $derived(assets.find((a) => a.id === layout.backgroundAssetId));

  const qrSvg = (color: string) =>
    encodeQR(`https://example.com/verify/${SAMPLE_VALUES.certificate_id}`, "svg").replace(
      /fill="black"/g,
      `fill="${color}"`,
    );

  const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);
  const round = (n: number) => Math.round(n * 10) / 10;

  // ---- Dragging / resizing ----
  type Drag = { index: number; mode: "move" | "resize"; startX: number; startY: number; orig: DesignElement };
  let drag: Drag | null = null;

  function startDrag(e: PointerEvent, index: number, mode: Drag["mode"]) {
    e.stopPropagation();
    selected = index;
    drag = { index, mode, startX: e.clientX, startY: e.clientY, orig: { ...layout.elements[index] } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onDrag(e: PointerEvent) {
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / scale;
    const dy = (e.clientY - drag.startY) / scale;
    const el = layout.elements[drag.index];
    const o = drag.orig;

    if (drag.mode === "move") {
      el.x = round(clamp(o.x + dx, 0, pageDims.width - 10));
      el.y = round(clamp(o.y + dy, 0, pageDims.height - 10));
    } else if (el.type === "text" && o.type === "text") {
      el.width = round(clamp(o.width + dx, 10, pageDims.width - el.x));
    } else if (el.type === "image" && o.type === "image") {
      el.width = round(clamp(o.width + dx, 1, pageDims.width - el.x));
      el.height = round(clamp(o.height + dy, 1, pageDims.height - el.y));
    } else if (el.type === "qr" && o.type === "qr") {
      el.size = round(clamp(o.size + Math.max(dx, dy), 24, 300));
    }
  }

  const endDrag = () => (drag = null);

  function onElementKey(e: KeyboardEvent, index: number) {
    const step = e.shiftKey ? 10 : 1;
    const el = layout.elements[index];
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      el.x = round(clamp(el.x + moves[e.key][0], 0, pageDims.width - 10));
      el.y = round(clamp(el.y + moves[e.key][1], 0, pageDims.height - 10));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelected();
    }
  }

  // ---- Element actions ----
  function addElement(el: DesignElement) {
    if (layout.elements.length >= MAX_ELEMENTS) {
      message = { kind: "error", text: `A design can have at most ${MAX_ELEMENTS} elements` };
      return;
    }
    layout.elements.push(el);
    selected = layout.elements.length - 1;
  }

  const addText = (text = "New text") =>
    addElement({
      type: "text",
      text,
      x: 60,
      y: round(pageDims.height / 2),
      width: round(pageDims.width - 120),
      fontSize: 24,
      font: "Helvetica",
      color: "#111827",
      align: "center",
    });

  function insertPlaceholder(key: string) {
    const token = `{{${key}}}`;
    if (current?.type === "text") current.text = `${current.text} ${token}`.trim();
    else addText(token);
  }

  const addQr = () =>
    addElement({ type: "qr", x: pageDims.width - 140, y: pageDims.height - 140, size: 100, color: "#111827" });

  const NEW_IMAGE_MAX_SIZE = 160;

  // New images start small and centred so they never cover existing content unnoticed
  function addImage(asset: Asset) {
    const ratio = asset.height / asset.width;
    const width = round(Math.min(NEW_IMAGE_MAX_SIZE, asset.width, NEW_IMAGE_MAX_SIZE / ratio));
    const height = round(width * ratio);
    addElement({
      type: "image",
      assetId: asset.id,
      x: round((pageDims.width - width) / 2),
      y: round((pageDims.height - height) / 2),
      width,
      height,
    });
  }

  // Switching orientation keeps every element but pulls anything now off-page back inside
  function setOrientation(orientation: Orientation) {
    layout.orientation = orientation;
    const { width, height } = pageSize(orientation);
    for (const el of layout.elements) {
      el.x = round(clamp(el.x, 0, width - 10));
      el.y = round(clamp(el.y, 0, height - 10));
      if (el.type === "text") el.width = round(clamp(el.width, 10, width - el.x));
      if (el.type === "image") {
        el.width = round(clamp(el.width, 1, width - el.x));
        el.height = round(clamp(el.height, 1, height - el.y));
      }
    }
  }

  function removeSelected() {
    if (selected === null) return;
    layout.elements.splice(selected, 1);
    selected = null;
  }

  function reorder(delta: number) {
    if (selected === null) return;
    const target = selected + delta;
    if (target < 0 || target >= layout.elements.length) return;
    const [el] = layout.elements.splice(selected, 1);
    layout.elements.splice(target, 0, el);
    selected = target;
  }

  // ---- Assets ----
  async function uploadAsset(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploading = true;
    message = null;
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", uploadKind);
      const res = await fetch("/api/v1/admin/assets", { method: "POST", body: form });
      if (!res.ok) {
        message = { kind: "error", text: await errorMessage(res, "Upload failed") };
        return;
      }
      const asset: Asset = await res.json();
      assets = [asset, ...assets];
      if (asset.kind === "background") layout.backgroundAssetId = asset.id;
      else addImage(asset);
    } finally {
      uploading = false;
      input.value = "";
    }
  }

  async function deleteAsset(asset: Asset) {
    if (!confirm("Delete this image?")) return;
    const res = await fetch(`/api/v1/admin/assets/${asset.id}`, { method: "DELETE" });
    if (res.ok) assets = assets.filter((a) => a.id !== asset.id);
    else message = { kind: "error", text: await errorMessage(res, "Failed to delete image") };
  }

  // ---- Save / preview ----
  async function save() {
    saving = true;
    message = null;
    try {
      const res = await fetch(designId ? `/api/v1/admin/designs/${designId}` : "/api/v1/admin/designs", {
        method: designId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, layout }),
      });
      if (!res.ok) {
        message = { kind: "error", text: await errorMessage(res, "Failed to save design") };
        return;
      }
      const saved = await res.json();
      message = { kind: "ok", text: "Design saved" };
      if (!designId) {
        designId = saved.id;
        await goto(`/admin/designs/${saved.id}`, { replace: true, reset: false });
      }
    } finally {
      saving = false;
    }
  }

  async function preview() {
    // Open the tab synchronously so popup blockers allow it
    const tab = window.open("", "_blank");
    const res = await fetch("/api/v1/admin/designs/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout }),
    });
    if (!res.ok) {
      tab?.close();
      message = { kind: "error", text: await errorMessage(res, "Preview failed") };
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
  }

  const inputClass =
    "w-full bg-black border border-zinc-800 rounded-md px-2 py-1.5 text-sm text-white focus:ring-2 focus:ring-blue-600 outline-none";
</script>

<svelte:window onpointermove={onDrag} onpointerup={endDrag} />

<div class="min-h-screen bg-black text-zinc-300 font-sans pb-16">
  <div class="max-w-7xl mx-auto px-4 md:px-6 pt-6">
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div class="flex items-center gap-3 min-w-0">
        <a href="/admin/designs" class="text-xs text-zinc-500 hover:text-white shrink-0">← Designs</a>
        <input
          bind:value={name}
          maxlength="100"
          aria-label="Design name"
          class="bg-transparent text-xl font-bold text-white border-b border-transparent hover:border-zinc-700 focus:border-blue-600 outline-none min-w-0"
        />
      </div>
      <div class="flex flex-wrap gap-2 text-sm">
        <label class="flex items-center gap-2 text-xs text-zinc-400 mr-2">
          <input type="checkbox" bind:checked={showSample} /> Sample data
        </label>
        <button onclick={preview} class="px-3 py-2 rounded-md border border-zinc-700 hover:border-zinc-500">
          Preview PDF
        </button>
        <button
          onclick={save}
          disabled={saving || !name.trim()}
          class="px-4 py-2 rounded-md bg-white text-black font-semibold hover:bg-zinc-200 disabled:opacity-50"
          >{saving ? "Saving..." : "Save"}</button
        >
      </div>
    </div>

    {#if message}
      <div
        class={`mb-3 p-2.5 rounded text-sm border ${message.kind === "error" ? "bg-red-900/20 border-red-900/50 text-red-400" : "bg-green-900/20 border-green-900/50 text-green-400"}`}
      >
        {message.text}
      </div>
    {/if}
    {#if warnings.length}
      <div class="mb-3 p-3 rounded bg-amber-900/20 border border-amber-900/50 text-amber-300 text-xs">
        <div class="font-semibold mb-1">Imported with notes:</div>
        <ul class="list-disc pl-5 space-y-0.5">
          {#each warnings as warning (warning)}<li>{warning}</li>{/each}
        </ul>
        <button class="mt-2 underline" onclick={() => (warnings = [])}>Dismiss</button>
      </div>
    {/if}

    <div class="grid lg:grid-cols-[1fr_300px] gap-4">
      <!-- Canvas -->
      <div>
        <div class="flex flex-wrap gap-2 mb-2 text-xs">
          <button onclick={() => addText()} class="px-2.5 py-1.5 rounded border border-zinc-700 hover:border-zinc-500">+ Text</button>
          <button onclick={addQr} class="px-2.5 py-1.5 rounded border border-zinc-700 hover:border-zinc-500">+ QR code</button>
          <span class="text-zinc-600 self-center">Insert:</span>
          {#each PLACEHOLDERS as key (key)}
            <button
              onclick={() => insertPlaceholder(key)}
              class="px-2 py-1.5 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-600 font-mono"
              >{`{{${key}}}`}</button
            >
          {/each}
        </div>

        <div
          bind:clientWidth={canvasWidth}
          role="presentation"
          onpointerdown={() => (selected = null)}
          class="relative w-full mx-auto overflow-hidden rounded-lg shadow-2xl select-none touch-none"
          style={`aspect-ratio: ${pageDims.width} / ${pageDims.height}; background: ${layout.backgroundColor};${isPortrait ? " max-width: 560px;" : ""}`}
        >
          {#if backgroundAsset}
            <img src={assetUrl(backgroundAsset.id)} alt="" class="absolute inset-0 w-full h-full pointer-events-none" />
          {/if}

          {#each layout.elements as el, i (i)}
            {@const isSelected = selected === i}
            <div
              role="button"
              tabindex="0"
              aria-label={el.type === "text" ? el.text : el.type}
              onpointerdown={(e) => startDrag(e, i, "move")}
              onkeydown={(e) => onElementKey(e, i)}
              class={`absolute cursor-move outline-offset-2 ${isSelected ? "outline-2 outline-blue-500" : "hover:outline-1 hover:outline-blue-400/60"}`}
              style={`left:${el.x * scale}px; top:${el.y * scale}px;` +
                (el.type === "text"
                  ? `width:${el.width * scale}px;`
                  : el.type === "image"
                    ? `width:${el.width * scale}px; height:${el.height * scale}px;`
                    : `width:${el.size * scale}px; height:${el.size * scale}px;`)}
            >
              {#if el.type === "text"}
                {@const f = cssFont(el.font)}
                <div
                  class="whitespace-nowrap overflow-visible leading-[1.2]"
                  style={`font-family:${f.family}; font-weight:${f.weight}; font-style:${f.style}; font-size:${el.fontSize * scale}px; color:${el.color}; text-align:${el.align};`}
                >
                  {showSample ? fillSample(el.text) : el.text}
                </div>
              {:else if el.type === "image"}
                <img src={assetUrl(el.assetId)} alt="" class="w-full h-full pointer-events-none" draggable="false" />
              {:else}
                <div class="w-full h-full [&>svg]:w-full [&>svg]:h-full">{@html qrSvg(el.color)}</div>
              {/if}

              {#if isSelected}
                <span
                  role="presentation"
                  onpointerdown={(e) => startDrag(e, i, "resize")}
                  class="absolute -right-1.5 -bottom-1.5 h-3 w-3 bg-blue-500 rounded-sm cursor-se-resize"
                ></span>
              {/if}
            </div>
          {/each}
        </div>
        <p class="text-[11px] text-zinc-600 mt-2">
          Drag to move · drag the blue corner to resize · arrow keys nudge (Shift = 10pt) · Delete removes
        </p>
      </div>

      <!-- Side panel -->
      <div class="space-y-4">
        <section class="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
          <h2 class="text-sm font-semibold text-white">
            {current ? (current.type === "text" ? "Text" : current.type === "image" ? "Image" : "QR code") : "Page"}
          </h2>

          {#if current?.type === "text"}
            <textarea bind:value={current.text} rows="2" maxlength="300" class={inputClass} aria-label="Text"></textarea>
            <select bind:value={current.font} class={inputClass} aria-label="Font">
              {#each FONTS as font (font)}<option value={font}>{font}</option>{/each}
            </select>
            <div class="grid grid-cols-3 gap-2">
              <input type="number" min="4" max="144" bind:value={current.fontSize} class={inputClass} aria-label="Font size" />
              <input type="color" bind:value={current.color} class="h-9 w-full rounded bg-black border border-zinc-800" aria-label="Colour" />
              <select bind:value={current.align} class={inputClass} aria-label="Alignment">
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
            <p class="text-[11px] text-zinc-500">Long values shrink automatically to fit the box width.</p>
          {:else if current?.type === "image"}
            <div class="grid grid-cols-2 gap-2">
              <label class="text-xs">W <input type="number" min="1" bind:value={current.width} class={inputClass} /></label>
              <label class="text-xs">H <input type="number" min="1" bind:value={current.height} class={inputClass} /></label>
            </div>
          {:else if current?.type === "qr"}
            <div class="grid grid-cols-2 gap-2">
              <label class="text-xs">Size <input type="number" min="24" max="300" bind:value={current.size} class={inputClass} /></label>
              <label class="text-xs">Colour <input type="color" bind:value={current.color} class="h-9 w-full rounded bg-black border border-zinc-800" /></label>
            </div>
            <p class="text-[11px] text-zinc-500">Links to the certificate's public verification page.</p>
          {:else}
            <div class="text-xs flex items-center justify-between">
              Orientation
              <div class="flex rounded-md border border-zinc-800 overflow-hidden">
                {#each ["landscape", "portrait"] as const as option (option)}
                  <button
                    onclick={() => setOrientation(option)}
                    aria-pressed={(layout.orientation ?? "landscape") === option}
                    class={`px-2.5 py-1 capitalize ${(layout.orientation ?? "landscape") === option ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-white"}`}
                    >{option}</button
                  >
                {/each}
              </div>
            </div>
            <label class="text-xs flex items-center justify-between">
              Background colour
              <input type="color" bind:value={layout.backgroundColor} class="h-8 w-14 rounded bg-black border border-zinc-800" />
            </label>
            {#if backgroundAsset}
              <button class="text-xs text-zinc-400 hover:text-white underline" onclick={() => (layout.backgroundAssetId = null)}>
                Remove background picture
              </button>
            {/if}
            <p class="text-[11px] text-zinc-500">Select an element on the canvas to edit it.</p>
          {/if}

          {#if current}
            <div class="grid grid-cols-2 gap-2">
              <label class="text-xs">X <input type="number" min="0" bind:value={current.x} class={inputClass} /></label>
              <label class="text-xs">Y <input type="number" min="0" bind:value={current.y} class={inputClass} /></label>
            </div>
            <div class="flex gap-2 text-xs">
              <button onclick={() => reorder(-1)} class="px-2 py-1 rounded border border-zinc-700">Send back</button>
              <button onclick={() => reorder(1)} class="px-2 py-1 rounded border border-zinc-700">Bring forward</button>
              <button onclick={removeSelected} class="ml-auto px-2 py-1 rounded border border-red-900/60 text-red-400">Delete</button>
            </div>
          {/if}
        </section>

        <section class="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
          <h2 class="text-sm font-semibold text-white">Images</h2>
          <div class="flex gap-2">
            <select bind:value={uploadKind} class={inputClass} aria-label="Image type">
              <option value="logo">Logo (≤1MB)</option>
              <option value="signature">Signature (≤1MB)</option>
              <option value="image">Other image (≤2MB)</option>
              <option value="background">Background (≤5MB)</option>
            </select>
            <label
              class={`shrink-0 px-3 py-1.5 rounded-md text-sm bg-blue-600 text-white hover:bg-blue-500 cursor-pointer ${uploading ? "opacity-50 pointer-events-none" : ""}`}
            >
              {uploading ? "..." : "Upload"}
              <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" onchange={uploadAsset} />
            </label>
          </div>
          <p class="text-[11px] text-zinc-500">PNG, JPEG or WebP. Backgrounds: A4 {isPortrait ? "portrait (e.g. 2480×3508)" : "landscape (e.g. 3508×2480)"}.</p>

          <div class="grid grid-cols-3 gap-2">
            {#each assets as asset (asset.id)}
              <div class="group relative bg-zinc-800/60 rounded border border-zinc-800 aspect-square flex items-center justify-center overflow-hidden">
                <img src={assetUrl(asset.id)} alt={asset.kind} class="max-w-full max-h-full object-contain" />
                <div class="absolute inset-0 bg-black/75 opacity-0 group-hover:opacity-100 focus-within:opacity-100 flex flex-col items-center justify-center gap-1 text-[11px]">
                  {#if asset.kind === "background"}
                    <button onclick={() => (layout.backgroundAssetId = asset.id)} class="text-white hover:underline">Use as background</button>
                  {:else}
                    <button onclick={() => addImage(asset)} class="text-white hover:underline">Add to page</button>
                  {/if}
                  <button onclick={() => deleteAsset(asset)} class="text-red-400 hover:underline">Delete</button>
                </div>
              </div>
            {:else}
              <p class="col-span-3 text-xs text-zinc-600">No images yet.</p>
            {/each}
          </div>
        </section>
      </div>
    </div>
  </div>
</div>
