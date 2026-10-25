<script lang="ts">
  import { Label } from "bits-ui";

  let email = $state("");
  let password = $state("");
  let isLoading = $state(false);
  let error = $state("");

  async function handleLogin(e: Event) {
    e.preventDefault();
    isLoading = true;
    error = "";

    try {
      const res = await fetch("/api/v1/auth/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (data.success) {
        window.location.href = "/admin";
      } else {
        error = data.message || "Login failed";
      }
    } catch {
      error = "Connection failed";
    } finally {
      isLoading = false;
    }
  }
</script>

<div
  class="min-h-screen bg-black flex items-center justify-center p-4 font-sans text-zinc-200"
>
  <div class="w-full max-w-sm relative group">
    <div
      class="absolute -inset-1 bg-linear-to-tr from-zinc-700 via-blue-900 to-purple-900 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-1000"
    ></div>

    <div
      class="relative bg-zinc-900 border border-zinc-800 rounded-xl p-8 shadow-2xl"
    >
      <div class="flex flex-col items-center mb-8">
        <h1 class="text-2xl font-bold tracking-tight text-white">Login</h1>
      </div>

      {#if error}
        <div
          class="mb-4 p-3 rounded bg-red-900/20 border border-red-900/50 text-red-400 text-xs text-center"
        >
          {error}
        </div>
      {/if}

      <form onsubmit={handleLogin} class="space-y-4">
        <div class="grid gap-2">
          <Label.Root class="text-xs font-medium text-zinc-400"
            >Email</Label.Root
          >
          <input
            type="email"
            bind:value={email}
            required
            placeholder="admin@company.com"
            class="flex h-10 w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <div class="grid gap-2">
          <Label.Root class="text-xs font-medium text-zinc-400"
            >Password</Label.Root
          >
          <input
            type="password"
            bind:value={password}
            required
            placeholder="••••••••"
            class="flex h-10 w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          class="w-full mt-4 h-10 rounded-md bg-white text-black font-semibold hover:bg-zinc-200 transition-all disabled:opacity-50 flex items-center justify-center"
        >
          {#if isLoading}
            <span class="animate-pulse">Verifying...</span>
          {:else}
            Sign In
          {/if}
        </button>
      </form>
    </div>

    <div class="text-center mt-6">
      <a
        href="/register"
        class="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >No account? Register</a
      >
    </div>
  </div>
</div>
