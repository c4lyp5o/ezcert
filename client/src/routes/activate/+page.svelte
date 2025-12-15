<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";

  let status = $state<"verifying" | "success" | "error">("verifying");
  let message = $state("Verifying your token...");

  onMount(async () => {
    const token = page.url.searchParams.get("token");

    if (!token) {
      status = "error";
      message = "Missing activation token.";
      return;
    }

    try {
      const res = await fetch("/api/v1/auth/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();

      if (data.success) {
        status = "success";
      } else {
        status = "error";
        message = data.message || "Activation failed.";
      }
    } catch {
      status = "error";
      message = "Network error.";
    }
  });
</script>

<div
  class="min-h-screen bg-black flex items-center justify-center p-4 font-sans text-zinc-200"
>
  <div
    class="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-xl p-8 shadow-2xl text-center"
  >
    {#if status === "verifying"}
      <div class="animate-pulse flex flex-col items-center">
        <div class="h-12 w-12 bg-zinc-800 rounded-full mb-4"></div>
        <h2 class="text-xl font-semibold text-white">Activating...</h2>
        <p class="text-zinc-500 text-sm mt-2">Please wait a moment.</p>
      </div>
    {:else if status === "success"}
      <div class="flex flex-col items-center">
        <div
          class="h-16 w-16 bg-green-900/20 rounded-full flex items-center justify-center mb-4 border border-green-900/50"
        >
          <svg
            class="w-8 h-8 text-green-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            ></path></svg
          >
        </div>
        <h2 class="text-xl font-semibold text-white">Account Activated!</h2>
        <p class="text-zinc-500 text-sm mt-2 mb-6">
          Your registration is complete.
        </p>

        <a
          href="/login"
          class="w-full py-2 bg-white text-black font-semibold rounded-md hover:bg-zinc-200 transition-colors block"
        >
          Proceed to Login
        </a>
      </div>
    {:else}
      <div class="flex flex-col items-center">
        <div
          class="h-16 w-16 bg-red-900/20 rounded-full flex items-center justify-center mb-4 border border-red-900/50"
        >
          <svg
            class="w-8 h-8 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            ></path></svg
          >
        </div>
        <h2 class="text-xl font-semibold text-white">Activation Failed</h2>
        <p class="text-red-400 text-sm mt-2 mb-6">{message}</p>
        <a href="/" class="text-zinc-500 hover:text-white text-sm"
          >Return Home</a
        >
      </div>
    {/if}
  </div>
</div>
