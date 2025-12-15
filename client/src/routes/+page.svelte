<div
  class="min-h-screen bg-black text-white font-sans selection:bg-blue-500 selection:text-white overflow-hidden relative"
>
  <div
    class="fixed top-[-20%] left-[-10%] h-125 w-125 rounded-full bg-blue-900/20 blur-[120px] pointer-events-none"
  ></div>
  <div
    class="fixed bottom-[-20%] right-[-10%] h-150 w-150 rounded-full bg-purple-900/10 blur-[150px] pointer-events-none"
  ></div>

  <nav
    class="relative z-10 flex items-center justify-between px-8 py-6 max-w-7xl mx-auto"
  >
    <div class="flex items-center gap-2">
      <div class="h-6 w-6 bg-white rounded-full"></div>
      <span class="font-bold text-lg tracking-tight">ezcert</span>
    </div>

    <a
      href="/login"
      class="text-sm font-medium text-zinc-400 hover:text-white transition-colors"
    >
      Login
    </a>
  </nav>

  <main
    class="relative z-10 flex flex-col items-center justify-center min-h-[80vh] px-4 text-center"
  >
    <div
      class="mb-8 inline-flex items-center rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1 text-xs font-medium text-zinc-400 backdrop-blur-xl"
    >
      <span class="mr-2 h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"
      ></span>
      v1.0 is now live
    </div>

    <h1
      class="max-w-4xl text-5xl font-extrabold tracking-tight sm:text-7xl lg:text-8xl text-transparent bg-clip-text bg-gradient-to-b from-white via-white to-zinc-500"
    >
      Attendance <br class="hidden sm:block" />
      made elegant.
    </h1>

    <p class="mt-6 max-w-2xl text-lg text-zinc-500 sm:text-xl leading-relaxed">
      Create events, generate QR codes, and issue beautiful PDF certificates
      instantly. No clutter. No complexity. Just <b>ezcert</b>.
    </p>

    <div class="mt-10 flex flex-col sm:flex-row gap-4">
      <a
        href="/register"
        class="inline-flex h-12 items-center justify-center rounded-full bg-white px-8 text-sm font-semibold text-black transition-transform hover:scale-105 hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 focus:ring-offset-black"
      >
        Get Started
      </a>
      <a
        href="https://github.com/c4lyp5o/ezcert"
        target="_blank"
        class="inline-flex h-12 items-center justify-center rounded-full border border-zinc-800 bg-transparent px-8 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-900 focus:outline-none"
      >
        View on GitHub
      </a>
    </div>
  </main>

  <footer class="absolute bottom-6 w-full text-center">
    <p class="text-[10px] uppercase tracking-widest text-zinc-700">
      Designed for simplicity
    </p>
  </footer>
</div>
