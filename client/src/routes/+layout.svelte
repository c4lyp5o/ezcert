<script lang="ts">
  import favicon from "$lib/assets/favicon.svg";
  import "../app.css";

  let { children } = $props();
</script>

<svelte:head>
  <title>EZCERT</title>
  <link rel="icon" href={favicon} />
  <meta
    name="description"
    content="Easy event attendance with cert generation"
  />
  <meta name="theme-color" content="#0a0a0a" />
</svelte:head>

{@render children()}
