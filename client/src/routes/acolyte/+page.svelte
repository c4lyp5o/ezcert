<script lang="ts">
  import { onMount } from "svelte";

  let step = $state<"username" | "password">("username");

  let username = $state("");
  let password = $state("");

  let shake = $state(false);
  let fadingOut = $state(false);
  let slideText = $state(false);

  onMount(() => {
    document.getElementById("void-input")?.focus();
  });

  async function handleKeydown(e: KeyboardEvent) {
    if (e.key !== "Enter") return;

    if (step === "username") {
      if (!username.trim()) return;

      slideText = true;
      setTimeout(() => {
        step = "password";
        slideText = false;
        setTimeout(() => document.getElementById("void-input")?.focus(), 50);
      }, 300);
      return;
    }

    if (step === "password") {
      await handleLogin();
    }
  }

  async function handleLogin() {
    const res = await fetch("/api/v1/auth/super/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (data.success) {
      fadingOut = true;
      setTimeout(() => {
        window.location.href = "/acolyte/altar";
      }, 1500);
    } else {
      password = "";
      shake = true;
      setTimeout(() => (shake = false), 500);
    }
  }
</script>

<div
  class="fixed inset-0 bg-black flex items-center justify-center overflow-hidden cursor-none font-serif"
>
  <div
    class={`absolute inset-0 bg-[radial-gradient(circle_at_center,var(--tw-gradient-stops))] from-indigo-900/10 via-black to-black transition-opacity duration-1000 ${fadingOut ? "opacity-0" : "opacity-100"}`}
  ></div>

  <div
    class={`relative z-10 text-center transition-all duration-1000 ${fadingOut ? "scale-150 blur-lg opacity-0" : "scale-100 opacity-100"}`}
  >
    <p
      class={`text-zinc-600 text-sm tracking-[0.5em] mb-8 uppercase opacity-50 select-none transition-all duration-300 ${slideText ? "-translate-y-2 opacity-0" : "translate-y-0"}`}
    >
      {#if step === "username"}
        Who approaches?
      {:else}
        Speak the word
      {/if}
    </p>

    <div class={shake ? "animate-shake" : ""}>
      {#if step === "username"}
        <input
          id="void-input"
          type="text"
          bind:value={username}
          onkeydown={handleKeydown}
          autocomplete="off"
          class="bg-transparent border-b border-zinc-900 text-center text-3xl md:text-5xl text-white tracking-widest focus:outline-none focus:border-zinc-700 transition-colors w-[300px] md:w-[500px] py-2 placeholder-zinc-800 caret-zinc-500 font-serif"
          placeholder="..."
        />
      {:else}
        <input
          id="void-input"
          type="password"
          bind:value={password}
          onkeydown={handleKeydown}
          autocomplete="off"
          class="bg-transparent border-b border-zinc-900 text-center text-3xl md:text-5xl text-white tracking-widest focus:outline-none focus:border-zinc-700 transition-colors w-[300px] md:w-[500px] py-2 placeholder-zinc-800 caret-zinc-500 font-serif"
          placeholder="..."
        />
      {/if}
    </div>
  </div>
</div>

<style>
  @keyframes shake {
    0%,
    100% {
      transform: translateX(0);
    }
    10%,
    30%,
    50%,
    70%,
    90% {
      transform: translateX(-4px);
    }
    20%,
    40%,
    60%,
    80% {
      transform: translateX(4px);
    }
  }
  .animate-shake {
    animation: shake 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
  }
  :global(body) {
    background: black;
  }
</style>
