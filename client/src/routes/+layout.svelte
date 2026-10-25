<script lang="ts">
  import favicon from "$lib/assets/favicon.svg";
  import { page } from "$app/state";
  import { Sun, Moon } from "lucide-svelte";
  import { initialTheme, saveTheme, type Theme } from "$lib/theme";
  import "../app.css";

  let { children } = $props();

  let theme = $state<Theme>(initialTheme());
  // Superadmin pages keep their own look.
  const themed = $derived(!page.url.pathname.startsWith("/acolyte"));

  $effect(() => {
    const root = document.documentElement;
    root.classList.toggle("theme-light", themed && theme === "light");
    root.classList.toggle("theme-dark", themed && theme === "dark");
  });

  function toggleTheme() {
    theme = theme === "light" ? "dark" : "light";
    saveTheme(theme);
  }
</script>

<svelte:head>
  <title>EZCERT</title>
  <link rel="icon" href={favicon} />
  <meta
    name="description"
    content="Easy event attendance with cert generation"
  />
  <meta name="theme-color" content={themed && theme === "light" ? "#f4f4f5" : "#0a0a0a"} />
</svelte:head>

{@render children()}

{#if themed}
  <button
    type="button"
    onclick={toggleTheme}
    class="fixed bottom-4 right-4 z-40 h-10 w-10 rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white shadow-lg flex items-center justify-center transition-colors print:hidden"
    aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    title={theme === "light" ? "Dark mode" : "Light mode"}
  >
    {#if theme === "light"}<Moon size={18} />{:else}<Sun size={18} />{/if}
  </button>
{/if}
