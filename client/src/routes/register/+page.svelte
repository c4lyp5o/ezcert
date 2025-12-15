<script lang="ts">
  import { Label } from "bits-ui";

  let tenantName = $state("");
  let email = $state("");
  let password = $state("");
  let status = $state<"idle" | "submitting" | "success" | "error">("idle");
  let errorMessage = $state("");

  async function handleRegister(e: Event) {
    e.preventDefault();
    status = "submitting";

    try {
      const res = await fetch("/api/v1/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantName, email, password }),
      });

      const data = await res.json();

      if (data.success) {
        status = "success";
      } else {
        status = "error";
        errorMessage = data.message || "Registration failed";
      }
    } catch (err) {
      status = "error";
      errorMessage = "Network error. Please try again.";
    }
  }
</script>

<div
  class="min-h-screen bg-black flex items-center justify-center p-4 font-sans text-zinc-200"
>
  <a
    href="/"
    class="absolute top-8 left-8 text-zinc-500 hover:text-white transition-colors text-sm font-medium"
  >
    ← Back
  </a>

  <div class="w-full max-w-md relative group">
    <div
      class="absolute -inset-1 bg-linear-to-br from-green-900 via-zinc-800 to-blue-900 rounded-2xl blur opacity-20 group-hover:opacity-30 transition duration-1000"
    ></div>

    <div
      class="relative bg-zinc-900 border border-zinc-800 rounded-xl p-8 shadow-2xl"
    >
      <div class="mb-8 text-center">
        <h1 class="text-2xl font-bold tracking-tight text-white mb-2">
          Partner with EzCert
        </h1>
        <p class="text-zinc-500 text-sm">
          Create an account to manage your event certificates.
        </p>
      </div>

      {#if status === "success"}
        <div class="text-center py-6 animate-in fade-in zoom-in duration-300">
          <div
            class="mx-auto h-16 w-16 bg-green-900/20 rounded-full flex items-center justify-center mb-4 border border-green-900/50"
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
          <h3 class="text-xl font-semibold text-white mb-2">
            Application Received
          </h3>
          <p class="text-zinc-400 text-sm leading-relaxed">
            Your registration for <b class="text-white">{tenantName}</b> has
            been submitted.
            <br /><br />
            Our team will review your application. Once approved, you will receive
            a <b>Magic Link</b> via email to access your dashboard.
          </p>
          <a
            href="/"
            class="mt-6 inline-block text-blue-400 hover:text-blue-300 text-sm font-medium"
            >Return Home</a
          >
        </div>
      {:else}
        <form onsubmit={handleRegister} class="space-y-5">
          <div class="grid gap-2">
            <Label.Root
              class="text-xs font-medium uppercase tracking-wider text-zinc-500 ml-1"
            >
              Company Name
            </Label.Root>
            <input
              type="text"
              bind:value={tenantName}
              required
              placeholder="Acme Corp"
              class="flex h-11 w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
            />
          </div>

          <div class="grid gap-2">
            <Label.Root
              class="text-xs font-medium uppercase tracking-wider text-zinc-500 ml-1"
            >
              Work Email
            </Label.Root>
            <input
              type="email"
              bind:value={email}
              required
              placeholder="admin@acme.com"
              class="flex h-11 w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
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

          {#if status === "error"}
            <div
              class="p-3 rounded bg-red-900/20 border border-red-900/50 text-red-400 text-xs"
            >
              {errorMessage}
            </div>
          {/if}

          <button
            type="submit"
            disabled={status === "submitting"}
            class="w-full mt-4 h-11 rounded-md bg-white text-black font-semibold hover:bg-zinc-200 transition-all disabled:opacity-50 flex items-center justify-center shadow-[0_0_15px_rgba(255,255,255,0.1)]"
          >
            {#if status === "submitting"}
              <span
                class="h-4 w-4 mr-2 border-2 border-zinc-400 border-t-black rounded-full animate-spin"
              ></span>
              Submitting...
            {:else}
              Submit Application
            {/if}
          </button>
        </form>
      {/if}
    </div>
  </div>
</div>
