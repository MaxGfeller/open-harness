<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from "vue";
import { Button } from "~/components/ui/button";
import {
  ArrowRight,
  Github,
  Star,
  Blocks,
  Layers,
  Shield,
  Cpu,
  Plug,
  Globe,
  Terminal,
  Zap,
  Package,
  BookOpen,
  Copy,
  Check,
  FileText,
  Sparkles,
  Loader2,
  RotateCcw,
} from "lucide-vue-next";

const activeTab = ref("agent");
const scrolled = ref(false);
const copied = ref(false);
const hovered = ref(false);
const mobileView = ref<"agent" | "code">("agent");

let observer: IntersectionObserver | null = null;

// ── Agent demo timeline ───────────────────────────

const TIMELINE: Array<{ key: string; delay: number; spinFor?: number }> = [
  { key: "user", delay: 400 },
  { key: "think1", delay: 500 },
  { key: "tool-read", delay: 400, spinFor: 1800 },
  { key: "think2", delay: 400 },
  { key: "tool-edit", delay: 400, spinFor: 2000 },
  { key: "tool-bash", delay: 400, spinFor: 1600 },
  { key: "response", delay: 500 },
];

const STREAM_TEXTS: Record<string, string> = {
  think1: "Analyzing the worker pool implementation...",
  think2: "Found it \u2014 worker refs aren't released on dispose",
  response:
    "Fixed the memory leak. Worker references in the pool weren't being released during dispose(), causing ~2MB retention per terminated worker.",
};

const visibleSteps = ref<Set<string>>(new Set());
const doneSteps = ref<Set<string>>(new Set());
const showReplay = ref(false);
const streamedTexts = ref<Record<string, string>>({
  think1: "",
  think2: "",
  response: "",
});
const streaming = ref<Set<string>>(new Set());

let timeouts: ReturnType<typeof setTimeout>[] = [];
let intervals: ReturnType<typeof setInterval>[] = [];

function streamText(key: string, speed = 2, tick = 22) {
  const full = STREAM_TEXTS[key];
  if (!full) return;
  let i = 0;
  streaming.value = new Set([...streaming.value, key]);
  const id = setInterval(() => {
    i = Math.min(i + speed, full.length);
    streamedTexts.value = { ...streamedTexts.value, [key]: full.slice(0, i) };
    if (i >= full.length) {
      clearInterval(id);
      streaming.value = new Set([...streaming.value].filter((k) => k !== key));
    }
  }, tick);
  intervals.push(id);
}

function runTimeline() {
  visibleSteps.value = new Set();
  doneSteps.value = new Set();
  showReplay.value = false;
  streaming.value = new Set();
  streamedTexts.value = { think1: "", think2: "", response: "" };
  timeouts.forEach(clearTimeout);
  intervals.forEach(clearInterval);
  timeouts = [];
  intervals = [];

  let cumulative = 0;
  for (const step of TIMELINE) {
    cumulative += step.delay;
    const showAt = cumulative;
    const k = step.key;
    timeouts.push(
      setTimeout(() => {
        visibleSteps.value = new Set([...visibleSteps.value, k]);
        if (STREAM_TEXTS[k]) streamText(k);
      }, showAt),
    );

    if (step.spinFor) {
      const doneAt = showAt + step.spinFor;
      cumulative += step.spinFor;
      timeouts.push(
        setTimeout(() => {
          doneSteps.value = new Set([...doneSteps.value, k]);
        }, doneAt),
      );
    }
  }

  cumulative += 800;
  timeouts.push(setTimeout(() => { showReplay.value = true; }, cumulative));
}

function replayDemo() {
  runTimeline();
}

async function copyInstall() {
  await navigator.clipboard.writeText("npm install @openharness/core");
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 2000);
}

function onScroll() {
  scrolled.value = window.scrollY > 20;
}

const features = [
  {
    icon: Cpu,
    title: "Stateless Agents",
    description:
      "Full control over message history. Inspect, modify, or share state between agents as plain arrays.",
  },
  {
    icon: Blocks,
    title: "Composable Middleware",
    description:
      "Mix and match turn tracking, retry, compaction, and persistence. Use only what you need.",
  },
  {
    icon: Layers,
    title: "Subagent Hierarchies",
    description:
      "Delegate tasks to specialized child agents with background execution and Promise-like combinators.",
  },
  {
    icon: Zap,
    title: "Context Compaction",
    description:
      "Automatic two-phase context management: pruning old tool results, then LLM-powered summarization.",
  },
  {
    icon: Shield,
    title: "Tool Permissions",
    description:
      "Async approval callbacks for gating tool execution. Works in CLI prompts, web modals, or external services.",
  },
  {
    icon: Plug,
    title: "MCP Integration",
    description:
      "Connect to any Model Context Protocol server via stdio, HTTP, or SSE transport.",
  },
  {
    icon: Sparkles,
    title: "Skills & AGENTS.md",
    description:
      "On-demand SKILL.md instruction loading and automatic AGENTS.md/CLAUDE.md project context injection.",
  },
  {
    icon: Globe,
    title: "Any Provider",
    description:
      "Built on Vercel AI SDK. Works with OpenAI, Anthropic, Google, or any compatible model provider.",
  },
  {
    icon: Terminal,
    title: "Web & CLI",
    description:
      "React hooks, Vue composables, and streaming support. Build agents for any runtime.",
  },
];

const heroCode = `<span class="hl-kw">import</span> { <span class="hl-fn">Agent</span>, <span class="hl-fn">createFsTools</span>, <span class="hl-fn">createBashTool</span>,
  <span class="hl-fn">NodeFsProvider</span>, <span class="hl-fn">NodeShellProvider</span> } <span class="hl-kw">from</span> <span class="hl-str">"@openharness/core"</span>
<span class="hl-kw">import</span> { <span class="hl-fn">openai</span> } <span class="hl-kw">from</span> <span class="hl-str">"@ai-sdk/openai"</span>

<span class="hl-kw">const</span> agent = <span class="hl-kw">new</span> <span class="hl-fn">Agent</span>({
  <span class="hl-prop">model</span>: <span class="hl-fn">openai</span>(<span class="hl-str">"gpt-5.4"</span>),
  <span class="hl-prop">tools</span>: {
    ...<span class="hl-fn">createFsTools</span>(<span class="hl-kw">new</span> <span class="hl-fn">NodeFsProvider</span>()),
    <span class="hl-prop">bash</span>: <span class="hl-fn">createBashTool</span>(<span class="hl-kw">new</span> <span class="hl-fn">NodeShellProvider</span>()).<span class="hl-prop">bash</span>,
  },
})

<span class="hl-kw">for await</span> (<span class="hl-kw">const</span> ev <span class="hl-kw">of</span> agent.<span class="hl-fn">run</span>([], input)) {
  <span class="hl-kw">if</span> (ev.type === <span class="hl-str">"text.delta"</span>)
    process.stdout.<span class="hl-fn">write</span>(ev.text)
}`;

const codeExamples: Record<
  string,
  { title: string; filename: string; code: string }
> = {
  agent: {
    title: "Agent",
    filename: "agent.ts",
    code: `<span class="hl-kw">import</span> { <span class="hl-fn">Agent</span>, <span class="hl-fn">createFsTools</span>, <span class="hl-fn">createBashTool</span>,
  <span class="hl-fn">NodeFsProvider</span>, <span class="hl-fn">NodeShellProvider</span> } <span class="hl-kw">from</span> <span class="hl-str">"@openharness/core"</span>
<span class="hl-kw">import</span> { <span class="hl-fn">openai</span> } <span class="hl-kw">from</span> <span class="hl-str">"@ai-sdk/openai"</span>

<span class="hl-kw">const</span> fsTools = <span class="hl-fn">createFsTools</span>(<span class="hl-kw">new</span> <span class="hl-fn">NodeFsProvider</span>())
<span class="hl-kw">const</span> { bash } = <span class="hl-fn">createBashTool</span>(<span class="hl-kw">new</span> <span class="hl-fn">NodeShellProvider</span>())

<span class="hl-kw">const</span> agent = <span class="hl-kw">new</span> <span class="hl-fn">Agent</span>({
  <span class="hl-prop">name</span>: <span class="hl-str">"assistant"</span>,
  <span class="hl-prop">model</span>: <span class="hl-fn">openai</span>(<span class="hl-str">"gpt-5.4"</span>),
  <span class="hl-prop">systemPrompt</span>: <span class="hl-str">"You are a helpful coding assistant."</span>,
  <span class="hl-prop">tools</span>: { ...fsTools, bash },
  <span class="hl-prop">maxSteps</span>: <span class="hl-num">20</span>,
  <span class="hl-prop">approve</span>: <span class="hl-kw">async</span> ({ toolName }) =&gt; {
    <span class="hl-kw">return await</span> <span class="hl-fn">askUser</span>(<span class="hl-str">\`Allow \${toolName}?\`</span>) === <span class="hl-str">"yes"</span>
  },
})

<span class="hl-kw">let</span> messages = []
<span class="hl-kw">for await</span> (<span class="hl-kw">const</span> event <span class="hl-kw">of</span> agent.<span class="hl-fn">run</span>(messages, <span class="hl-str">"Fix the login bug"</span>)) {
  <span class="hl-kw">switch</span> (event.type) {
    <span class="hl-kw">case</span> <span class="hl-str">"text.delta"</span>:
      process.stdout.<span class="hl-fn">write</span>(event.text); <span class="hl-kw">break</span>
    <span class="hl-kw">case</span> <span class="hl-str">"tool.done"</span>:
      console.<span class="hl-fn">log</span>(<span class="hl-str">\`Done: \${event.toolName}\`</span>); <span class="hl-kw">break</span>
    <span class="hl-kw">case</span> <span class="hl-str">"done"</span>:
      messages = event.messages; <span class="hl-kw">break</span>
  }
}`,
  },
  middleware: {
    title: "Middleware",
    filename: "middleware.ts",
    code: `<span class="hl-kw">import</span> { <span class="hl-fn">apply</span>, <span class="hl-fn">toRunner</span>, <span class="hl-fn">withTurnTracking</span>,
  <span class="hl-fn">withCompaction</span>, <span class="hl-fn">withRetry</span>, <span class="hl-fn">withPersistence</span>,
  <span class="hl-fn">Conversation</span> } <span class="hl-kw">from</span> <span class="hl-str">"@openharness/core"</span>

<span class="hl-cmt">// Compose a middleware stack — use only what you need</span>
<span class="hl-kw">const</span> runner = <span class="hl-fn">apply</span>(
  <span class="hl-fn">toRunner</span>(agent),
  <span class="hl-fn">withTurnTracking</span>(),
  <span class="hl-fn">withCompaction</span>({
    <span class="hl-prop">contextWindow</span>: <span class="hl-num">200_000</span>,
    <span class="hl-prop">model</span>: agent.model,
  }),
  <span class="hl-fn">withRetry</span>({ <span class="hl-prop">maxRetries</span>: <span class="hl-num">5</span> }),
  <span class="hl-fn">withPersistence</span>({ store, <span class="hl-prop">sessionId</span>: <span class="hl-str">"abc"</span> }),
)

<span class="hl-kw">const</span> chat = <span class="hl-kw">new</span> <span class="hl-fn">Conversation</span>({ runner })

<span class="hl-kw">for await</span> (<span class="hl-kw">const</span> event <span class="hl-kw">of</span> chat.<span class="hl-fn">send</span>(<span class="hl-str">"Refactor the config"</span>)) {
  <span class="hl-kw">if</span> (event.type === <span class="hl-str">"text.delta"</span>)
    process.stdout.<span class="hl-fn">write</span>(event.text)
  <span class="hl-kw">if</span> (event.type === <span class="hl-str">"compaction.done"</span>)
    console.<span class="hl-fn">log</span>(<span class="hl-str">\`Compacted: \${event.before} → \${event.after}\`</span>)
}`,
  },
  subagents: {
    title: "Subagents",
    filename: "subagents.ts",
    code: `<span class="hl-kw">const</span> explorer = <span class="hl-kw">new</span> <span class="hl-fn">Agent</span>({
  <span class="hl-prop">name</span>: <span class="hl-str">"explore"</span>,
  <span class="hl-prop">description</span>: <span class="hl-str">"Read-only codebase exploration"</span>,
  <span class="hl-prop">model</span>: <span class="hl-fn">openai</span>(<span class="hl-str">"gpt-5.4"</span>),
  <span class="hl-prop">tools</span>: { readFile, listFiles, grep },
  <span class="hl-prop">maxSteps</span>: <span class="hl-num">30</span>,
})

<span class="hl-kw">const</span> dev = <span class="hl-kw">new</span> <span class="hl-fn">Agent</span>({
  <span class="hl-prop">name</span>: <span class="hl-str">"dev"</span>,
  <span class="hl-prop">model</span>: <span class="hl-fn">openai</span>(<span class="hl-str">"gpt-5.4"</span>),
  <span class="hl-prop">tools</span>: { ...fsTools, bash },
  <span class="hl-prop">subagents</span>: [explorer],
  <span class="hl-prop">onSubagentEvent</span>: (path, event) =&gt; {
    console.<span class="hl-fn">log</span>(<span class="hl-str">\`[\${path.join(" › ")}] \${event.type}\`</span>)
  },
})

<span class="hl-cmt">// The dev agent delegates exploration tasks automatically.</span>
<span class="hl-cmt">// Subagents can run in the background with Promise combinators:</span>
<span class="hl-cmt">// agent.background.all(), .race(), .any(), .allSettled()</span>
<span class="hl-kw">for await</span> (<span class="hl-kw">const</span> event <span class="hl-kw">of</span> dev.<span class="hl-fn">run</span>([], userInput)) {
  <span class="hl-kw">if</span> (event.type === <span class="hl-str">"text.delta"</span>)
    process.stdout.<span class="hl-fn">write</span>(event.text)
}`,
  },
};

const stepCode = {
  install: `<span class="hl-fn">npm</span> install @openharness/core`,
  configure: `<span class="hl-kw">const</span> agent = <span class="hl-kw">new</span> <span class="hl-fn">Agent</span>({
  <span class="hl-prop">model</span>: <span class="hl-fn">openai</span>(<span class="hl-str">"gpt-5.4"</span>),
  <span class="hl-prop">tools</span>: { readFile, bash },
})`,
  run: `<span class="hl-kw">for await</span> (<span class="hl-kw">const</span> ev <span class="hl-kw">of</span> agent.<span class="hl-fn">run</span>([], input)) {
  <span class="hl-cmt">// stream events to your UI</span>
}`,
};

let demoStarted = false;

onMounted(() => {
  window.addEventListener("scroll", onScroll, { passive: true });

  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          // Start the demo timeline when the agent UI becomes visible
          if (
            !demoStarted &&
            entry.target.classList.contains("agent-demo-trigger")
          ) {
            demoStarted = true;
            runTimeline();
          }
        }
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -60px 0px" },
  );

  nextTick(() => {
    document.querySelectorAll(".reveal").forEach((el) => {
      observer?.observe(el);
    });
  });
});

onUnmounted(() => {
  window.removeEventListener("scroll", onScroll);
  observer?.disconnect();
  timeouts.forEach(clearTimeout);
  intervals.forEach(clearInterval);
});
</script>

<template>
  <div class="min-h-screen bg-[#09090B]">
    <!-- ───────────────────────── Navigation ───────────────────────── -->
    <header
      :class="[
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
        scrolled
          ? 'bg-[#09090B]/80 backdrop-blur-xl border-b border-white/[0.06]'
          : '',
      ]"
    >
      <div
        class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between"
      >
        <a href="/" class="flex items-center gap-0.5 group">
          <span class="font-mono text-lg tracking-tight">
            <span
              class="text-zinc-500 group-hover:text-violet-400 transition-colors"
              >open</span
            ><span class="font-semibold text-white">harness</span>
          </span>
        </a>

        <nav class="flex items-center gap-1">
          <a
            href="https://docs.open-harness.dev"
            class="text-sm text-zinc-400 hover:text-white transition-colors px-3 py-2 rounded-md hover:bg-white/5"
          >
            Docs
          </a>
          <a
            href="https://github.com/MaxGfeller/open-harness"
            target="_blank"
            rel="noopener"
            class="text-sm text-zinc-400 hover:text-white transition-colors px-3 py-2 rounded-md hover:bg-white/5 flex items-center gap-1.5"
          >
            <Github class="w-4 h-4" />
            <span class="hidden sm:inline">GitHub</span>
          </a>
          <a
            href="https://www.npmjs.com/package/@openharness/core"
            target="_blank"
            rel="noopener"
            class="text-sm text-zinc-400 hover:text-white transition-colors px-3 py-2 rounded-md hover:bg-white/5 flex items-center gap-1.5"
          >
            <Package class="w-4 h-4" />
            <span class="hidden sm:inline">npm</span>
          </a>
        </nav>
      </div>
    </header>

    <!-- ───────────────────────────── Hero ──────────────────────────── -->
    <section class="relative pt-28 pb-20 lg:pt-44 lg:pb-36 overflow-hidden">
      <!-- Gradient mesh background -->
      <div class="absolute inset-0 hero-gradient" />
      <div class="absolute inset-0 hero-grid opacity-[0.04]" />
      <div
        class="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-violet-500/[0.12] rounded-full blur-[150px] pointer-events-none"
      />
      <div
        class="absolute bottom-0 right-0 w-[400px] h-[400px] bg-fuchsia-500/[0.08] rounded-full blur-[120px] pointer-events-none"
      />

      <div class="relative max-w-6xl mx-auto px-6">
        <div
          class="grid lg:grid-cols-[1fr,1.05fr] gap-12 lg:gap-20 items-center"
        >
          <!-- Text column -->
          <div class="reveal">
            <h1
              class="font-display text-[2.75rem] sm:text-5xl md:text-6xl lg:text-[4.25rem] tracking-[-0.035em] text-white leading-[1.08] mb-6"
            >
              Composable SDK to build<br>
              <span
                class="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent font-display-italic"
                >powerful agent harnesses</span
              >
            </h1>

            <p
              class="text-lg sm:text-xl text-zinc-400 max-w-[500px] mb-10 leading-relaxed"
            >
              The open-source toolkit for building Claude Code-like products.
              Stateless primitives, composable middleware, hierarchical
              subagents. Any model provider.
            </p>

            <div class="flex flex-wrap items-center gap-3">
              <Button
                as="a"
                href="https://docs.open-harness.dev"
                size="lg"
                class="bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/30 transition-all hover:shadow-xl hover:shadow-violet-500/30 h-12 px-7 text-[15px] font-medium"
              >
                Read the Docs
                <ArrowRight class="w-4 h-4 ml-1" />
              </Button>
              <Button
                as="a"
                href="https://github.com/MaxGfeller/open-harness"
                target="_blank"
                rel="noopener"
                variant="outline"
                size="lg"
                class="border-white/10 hover:border-violet-500/40 hover:bg-violet-500/10 text-zinc-300 hover:text-white h-12 px-7 text-[15px] font-medium"
              >
                <Star class="w-4 h-4" />
                Star on GitHub
              </Button>
            </div>
          </div>

          <!-- Visual: code behind + agent UI overlaid -->
          <div class="reveal agent-demo-trigger" style="transition-delay: 150ms">
            <div class="relative">
              <!-- Code snippet (behind on desktop; full-width on mobile when toggled) -->
              <div
                :class="[
                  'lg:block lg:absolute lg:-top-4 lg:-left-4 lg:w-[56%] lg:z-0',
                  'transition-all duration-500 ease-out lg:origin-top-left',
                  hovered
                    ? 'lg:opacity-100 lg:scale-100 lg:!-top-2 lg:!-left-2 lg:!w-[72%]'
                    : 'lg:opacity-60 lg:scale-[0.92]',
                  mobileView === 'code' ? 'block' : 'hidden',
                ]"
                @mouseenter="hovered = true"
                @mouseleave="hovered = false"
              >
                <div class="code-glow">
                  <div class="code-window">
                    <div class="code-header !justify-center">
                      <span class="text-xs text-zinc-500 font-mono lg:text-[11px] lg:text-zinc-600"
                        >agent.ts</span
                      >
                    </div>
                    <pre
                      class="code-content text-[13px] leading-[1.75] lg:!py-3 lg:!px-4 lg:!text-[11.5px] lg:!leading-[1.65]"
                    ><code v-html="heroCode" /></pre>
                  </div>
                </div>
              </div>

              <!-- Agent UI (foreground on desktop; hidden on mobile when viewing code) -->
              <div
                :class="[
                  'relative z-10 lg:ml-[22%] lg:mt-10',
                  'transition-all duration-500 ease-out lg:origin-top-right',
                  hovered
                    ? 'lg:opacity-15 lg:scale-[0.88] lg:translate-x-[5%] lg:translate-y-[3%] lg:blur-[1px] lg:pointer-events-none'
                    : 'opacity-100 scale-100',
                  mobileView === 'code' ? 'hidden lg:block' : '',
                ]"
              >
                <div class="agent-window">
                  <div class="agent-window-header">
                    <div class="flex items-center gap-2">
                      <div
                        class="w-2 h-2 rounded-full bg-emerald-500 agent-pulse"
                      />
                      <span class="text-xs text-zinc-500 font-medium"
                        >Agent Session</span
                      >
                    </div>
                  </div>
                  <div class="agent-window-content min-h-[400px]">
                    <!-- User message -->
                    <Transition name="agent-step">
                      <div v-if="visibleSteps.has('user')">
                        <div class="flex items-start gap-3">
                          <div
                            class="w-6 h-6 rounded-full bg-violet-600/80 flex items-center justify-center shrink-0 mt-0.5"
                          >
                            <span class="text-[10px] font-bold text-white"
                              >U</span
                            >
                          </div>
                          <p class="text-[13px] text-zinc-200 leading-relaxed">
                            Find and fix the memory leak in the worker pool
                          </p>
                        </div>
                        <div
                          class="border-t border-white/[0.04] -mx-4 mt-3 mb-1"
                        />
                      </div>
                    </Transition>

                    <!-- Thinking 1 -->
                    <Transition name="agent-step">
                      <div v-if="visibleSteps.has('think1')">
                        <p
                          class="text-[12px] text-zinc-600 italic pl-9 flex items-start gap-1.5"
                        >
                          <Sparkles
                            class="w-3 h-3 text-violet-500/60 shrink-0 mt-px"
                          />
                          <span
                            >{{ streamedTexts.think1
                            }}<span
                              v-if="streaming.has('think1')"
                              class="stream-cursor"
                            /></span>
                        </p>
                      </div>
                    </Transition>

                    <!-- Tool: readFile -->
                    <Transition name="agent-step">
                      <div v-if="visibleSteps.has('tool-read')">
                        <div class="tool-card">
                          <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                              <FileText
                                class="w-3.5 h-3.5 text-violet-400/80"
                              />
                              <span
                                class="text-[12px] font-medium text-zinc-300"
                                >readFile</span
                              >
                            </div>
                            <Transition name="status-swap" mode="out-in">
                              <Loader2
                                v-if="!doneSteps.has('tool-read')"
                                key="spin"
                                class="w-3.5 h-3.5 text-violet-400 animate-spin"
                              />
                              <Check
                                v-else
                                key="done"
                                class="w-3.5 h-3.5 text-emerald-500"
                              />
                            </Transition>
                          </div>
                          <p
                            class="text-[11px] text-zinc-600 mt-1 font-mono truncate"
                          >
                            src/workers/pool.ts
                          </p>
                        </div>
                      </div>
                    </Transition>

                    <!-- Thinking 2 -->
                    <Transition name="agent-step">
                      <div v-if="visibleSteps.has('think2')">
                        <p
                          class="text-[12px] text-zinc-600 italic pl-9 flex items-start gap-1.5"
                        >
                          <Sparkles
                            class="w-3 h-3 text-violet-500/60 shrink-0 mt-px"
                          />
                          <span
                            >{{ streamedTexts.think2
                            }}<span
                              v-if="streaming.has('think2')"
                              class="stream-cursor"
                            /></span>
                        </p>
                      </div>
                    </Transition>

                    <!-- Tool: editFile -->
                    <Transition name="agent-step">
                      <div v-if="visibleSteps.has('tool-edit')">
                        <div class="tool-card">
                          <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                              <FileText
                                class="w-3.5 h-3.5 text-violet-400/80"
                              />
                              <span
                                class="text-[12px] font-medium text-zinc-300"
                                >editFile</span
                              >
                            </div>
                            <Transition name="status-swap" mode="out-in">
                              <Loader2
                                v-if="!doneSteps.has('tool-edit')"
                                key="spin"
                                class="w-3.5 h-3.5 text-violet-400 animate-spin"
                              />
                              <Check
                                v-else
                                key="done"
                                class="w-3.5 h-3.5 text-emerald-500"
                              />
                            </Transition>
                          </div>
                          <p
                            class="text-[11px] text-zinc-600 mt-1 font-mono truncate"
                          >
                            pool.ts:142 &mdash; fixed dispose()
                          </p>
                        </div>
                      </div>
                    </Transition>

                    <!-- Tool: bash -->
                    <Transition name="agent-step">
                      <div v-if="visibleSteps.has('tool-bash')">
                        <div class="tool-card">
                          <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                              <Terminal
                                class="w-3.5 h-3.5 text-violet-400/80"
                              />
                              <span
                                class="text-[12px] font-medium text-zinc-300"
                                >bash</span
                              >
                            </div>
                            <Transition name="status-swap" mode="out-in">
                              <Loader2
                                v-if="!doneSteps.has('tool-bash')"
                                key="spin"
                                class="w-3.5 h-3.5 text-violet-400 animate-spin"
                              />
                              <Check
                                v-else
                                key="done"
                                class="w-3.5 h-3.5 text-emerald-500"
                              />
                            </Transition>
                          </div>
                          <p
                            class="text-[11px] text-zinc-600 mt-1 font-mono truncate"
                          >
                            npm test -- workers &rarr; 12 passed
                          </p>
                        </div>
                      </div>
                    </Transition>

                    <!-- Agent response -->
                    <Transition name="agent-step">
                      <div v-if="visibleSteps.has('response')">
                        <div class="pl-9">
                          <p class="text-[13px] text-zinc-300 leading-relaxed">
                            {{ streamedTexts.response
                            }}<span
                              v-if="streaming.has('response')"
                              class="stream-cursor"
                            />
                          </p>
                        </div>
                      </div>
                    </Transition>

                    <!-- Replay button -->
                    <Transition name="agent-step">
                      <div v-if="showReplay" class="flex justify-center pt-2">
                        <button
                          class="flex items-center gap-1.5 text-[11px] text-zinc-600 hover:text-violet-400 transition-colors group"
                          @click="replayDemo"
                        >
                          <RotateCcw
                            class="w-3 h-3 group-hover:rotate-[-90deg] transition-transform duration-300"
                          />
                          Replay
                        </button>
                      </div>
                    </Transition>
                  </div>
                </div>
              </div>

              <!-- Mobile view toggle -->
              <div class="lg:hidden flex justify-center mt-4">
                <div
                  class="inline-flex rounded-lg border border-white/[0.08] overflow-hidden"
                >
                  <button
                    :class="[
                      'px-4 py-1.5 text-xs font-medium transition-colors',
                      mobileView === 'agent'
                        ? 'bg-violet-500/15 text-violet-300'
                        : 'text-zinc-500 hover:text-zinc-300',
                    ]"
                    @click="mobileView = 'agent'"
                  >
                    Demo
                  </button>
                  <button
                    :class="[
                      'px-4 py-1.5 text-xs font-medium transition-colors',
                      mobileView === 'code'
                        ? 'bg-violet-500/15 text-violet-300'
                        : 'text-zinc-500 hover:text-zinc-300',
                    ]"
                    @click="mobileView = 'code'"
                  >
                    Source
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ──────────────────────── Install Banner ─────────────────────── -->
    <section class="border-y border-white/[0.06] bg-white/[0.02]">
      <div
        class="max-w-6xl mx-auto px-6 py-4 flex items-center justify-center gap-3"
      >
        <span class="text-sm text-zinc-500 hidden sm:inline"
          >Get started:</span
        >
        <button
          class="font-mono text-sm bg-white/[0.04] border border-white/[0.08] rounded-lg px-4 py-2 text-zinc-300 hover:border-violet-500/30 hover:bg-violet-500/5 transition-all flex items-center gap-3 group"
          @click="copyInstall"
        >
          <span>npm install @openharness/core</span>
          <component
            :is="copied ? Check : Copy"
            :class="[
              'w-3.5 h-3.5 transition-colors',
              copied
                ? 'text-violet-400'
                : 'text-zinc-500 group-hover:text-zinc-300',
            ]"
          />
        </button>
      </div>
    </section>

    <!-- ───────────────────────── Features ──────────────────────────── -->
    <section class="py-24 lg:py-32">
      <div class="max-w-6xl mx-auto px-6">
        <div class="max-w-2xl mb-16 reveal">
          <h2
            class="text-3xl sm:text-4xl font-semibold tracking-tight text-white mb-4"
          >
            Everything you need to build agents
          </h2>
          <p class="text-lg text-zinc-400 leading-relaxed">
            Composable primitives that give you full control. No magic, no
            lock-in &mdash; just clean TypeScript APIs built on top of Vercel AI
            SDK.
          </p>
        </div>

        <div
          class="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.06] rounded-xl overflow-hidden"
        >
          <div
            v-for="(feature, i) in features"
            :key="feature.title"
            class="reveal bg-[#09090B] p-6 lg:p-8 group hover:bg-white/[0.03] transition-colors"
            :style="{ transitionDelay: `${i * 50}ms` }"
          >
            <div
              class="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center mb-4 group-hover:bg-violet-500/20 transition-colors"
            >
              <component
                :is="feature.icon"
                class="w-5 h-5 text-violet-400"
              />
            </div>
            <h3 class="text-[15px] font-semibold text-white mb-2">
              {{ feature.title }}
            </h3>
            <p class="text-sm text-zinc-500 leading-relaxed">
              {{ feature.description }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- ──────────────────────── Code Examples ──────────────────────── -->
    <section class="py-24 lg:py-32 relative overflow-hidden">
      <div class="absolute inset-0 bg-gradient-to-b from-violet-500/[0.03] via-transparent to-transparent pointer-events-none" />
      <div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-violet-500/[0.04] rounded-full blur-[150px] pointer-events-none"
      />

      <div class="relative max-w-6xl mx-auto px-6">
        <div class="max-w-2xl mb-12 reveal">
          <h2
            class="text-3xl sm:text-4xl font-semibold tracking-tight text-white mb-4"
          >
            See it in action
          </h2>
          <p class="text-lg text-zinc-400 leading-relaxed">
            From a simple agent to composable middleware stacks and hierarchical
            subagent delegation.
          </p>
        </div>

        <div class="reveal" style="transition-delay: 100ms">
          <!-- Tabs -->
          <div class="flex gap-1 mb-6">
            <button
              v-for="tab in (['agent', 'middleware', 'subagents'] as const)"
              :key="tab"
              :class="[
                'px-4 py-2 rounded-md text-sm font-medium transition-all',
                activeTab === tab
                  ? 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/20'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5',
              ]"
              @click="activeTab = tab"
            >
              {{ codeExamples[tab].title }}
            </button>
          </div>

          <!-- Code window -->
          <div class="code-window-dark">
            <div class="code-header-dark">
              <div class="flex gap-1.5">
                <span class="w-2.5 h-2.5 rounded-full bg-[#FF5F57]/60" />
                <span class="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]/60" />
                <span class="w-2.5 h-2.5 rounded-full bg-[#28C840]/60" />
              </div>
              <span class="text-xs text-zinc-600 font-mono">{{
                codeExamples[activeTab].filename
              }}</span>
              <div class="w-12" />
            </div>
            <Transition name="fade" mode="out-in">
              <pre
                :key="activeTab"
                class="code-content text-[13px] leading-[1.75]"
              ><code v-html="codeExamples[activeTab].code" /></pre>
            </Transition>
          </div>
        </div>
      </div>
    </section>

    <!-- ──────────────────────── How It Works ───────────────────────── -->
    <section class="py-24 lg:py-32 border-t border-white/[0.06]">
      <div class="max-w-6xl mx-auto px-6">
        <div class="text-center mb-16 reveal">
          <h2
            class="text-3xl sm:text-4xl font-semibold tracking-tight text-white mb-4"
          >
            Up and running in minutes
          </h2>
          <p class="text-lg text-zinc-400">Three steps to your first agent.</p>
        </div>

        <div class="grid md:grid-cols-3 gap-8 lg:gap-12">
          <!-- Step 1 -->
          <div class="reveal" style="transition-delay: 0ms">
            <div class="flex items-center gap-3 mb-4">
              <span
                class="w-8 h-8 rounded-full bg-violet-600 text-white text-sm font-semibold flex items-center justify-center"
              >
                1
              </span>
              <h3 class="text-lg font-semibold text-white">Install</h3>
            </div>
            <p class="text-sm text-zinc-500 mb-4">
              Add the core package to your project. Works with any Node.js or
              edge runtime.
            </p>
            <div class="code-window-sm">
              <pre
                class="code-content-sm"
              ><code v-html="stepCode.install" /></pre>
            </div>
          </div>

          <!-- Step 2 -->
          <div class="reveal" style="transition-delay: 100ms">
            <div class="flex items-center gap-3 mb-4">
              <span
                class="w-8 h-8 rounded-full bg-violet-600 text-white text-sm font-semibold flex items-center justify-center"
              >
                2
              </span>
              <h3 class="text-lg font-semibold text-white">Configure</h3>
            </div>
            <p class="text-sm text-zinc-500 mb-4">
              Define your agent with a model, tools, and optional middleware.
            </p>
            <div class="code-window-sm">
              <pre
                class="code-content-sm"
              ><code v-html="stepCode.configure" /></pre>
            </div>
          </div>

          <!-- Step 3 -->
          <div class="reveal" style="transition-delay: 200ms">
            <div class="flex items-center gap-3 mb-4">
              <span
                class="w-8 h-8 rounded-full bg-violet-600 text-white text-sm font-semibold flex items-center justify-center"
              >
                3
              </span>
              <h3 class="text-lg font-semibold text-white">Run</h3>
            </div>
            <p class="text-sm text-zinc-500 mb-4">
              Stream typed events to your CLI, web app, or any other interface.
            </p>
            <div class="code-window-sm">
              <pre
                class="code-content-sm"
              ><code v-html="stepCode.run" /></pre>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ────────────────────────── Author ────────────────────────────── -->
    <section class="py-16 border-t border-white/[0.06]">
      <div class="max-w-6xl mx-auto px-6">
        <div class="flex items-center justify-center gap-5 reveal">
          <img
            src="https://avatars.githubusercontent.com/u/361435?v=4"
            alt="MaxGfeller"
            class="w-14 h-14 rounded-full ring-2 ring-violet-500/30"
            loading="lazy"
          />
          <div>
            <p class="text-sm text-zinc-400">
              Built by
              <a
                href="https://github.com/MaxGfeller"
                target="_blank"
                rel="noopener"
                class="text-white font-medium hover:text-violet-400 transition-colors"
                >MaxGfeller</a
              >
            </p>
            <p class="text-sm text-zinc-600">Open source. MIT licensed.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ────────────────────────── CTA Band ─────────────────────────── -->
    <section class="py-24 lg:py-32 relative overflow-hidden">
      <div
        class="absolute inset-0 bg-gradient-to-t from-violet-500/[0.06] via-violet-500/[0.03] to-transparent pointer-events-none"
      />
      <div class="relative max-w-6xl mx-auto px-6 text-center reveal">
        <h2
          class="text-3xl sm:text-4xl font-semibold tracking-tight text-white mb-4"
        >
          Ready to build?
        </h2>
        <p class="text-lg text-zinc-400 mb-10 max-w-md mx-auto">
          Start building agents with composable, type-safe primitives today.
        </p>
        <div class="flex flex-wrap items-center justify-center gap-3">
          <Button
            as="a"
            href="https://docs.open-harness.dev"
            size="lg"
            class="bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/30 h-12 px-7 text-[15px] font-medium"
          >
            Read the Docs
            <ArrowRight class="w-4 h-4 ml-1" />
          </Button>
          <Button
            as="a"
            href="https://github.com/MaxGfeller/open-harness"
            target="_blank"
            rel="noopener"
            variant="outline"
            size="lg"
            class="border-white/10 hover:border-violet-500/40 hover:bg-violet-500/10 text-zinc-300 hover:text-white h-12 px-7 text-[15px] font-medium"
          >
            <Star class="w-4 h-4" />
            Star on GitHub
          </Button>
        </div>
      </div>
    </section>

    <!-- ──────────────────────────── Footer ─────────────────────────── -->
    <footer class="border-t border-white/[0.06] py-10">
      <div
        class="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4"
      >
        <div class="flex items-center gap-6">
          <span class="font-mono text-sm">
            <span class="text-zinc-600">open</span
            ><span class="font-semibold text-zinc-400">harness</span>
          </span>
          <span class="text-xs text-zinc-600">MIT License</span>
        </div>

        <nav class="flex items-center gap-5">
          <a
            href="https://docs.open-harness.dev"
            class="text-sm text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1.5"
          >
            <BookOpen class="w-3.5 h-3.5" />
            Docs
          </a>
          <a
            href="https://github.com/MaxGfeller/open-harness"
            target="_blank"
            rel="noopener"
            class="text-sm text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1.5"
          >
            <Github class="w-3.5 h-3.5" />
            GitHub
          </a>
          <a
            href="https://www.npmjs.com/package/@openharness/core"
            target="_blank"
            rel="noopener"
            class="text-sm text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1.5"
          >
            <Package class="w-3.5 h-3.5" />
            npm
          </a>
        </nav>
      </div>
    </footer>
  </div>
</template>

<style>
@import url("https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:ital,wght@0,400;0,500;1,400&display=swap");

/* ── Typography ─────────────────────────────────── */

.font-display {
  font-family: "Instrument Serif", Georgia, "Times New Roman", serif;
  font-weight: 400;
}

.font-display-italic {
  font-family: "Instrument Serif", Georgia, "Times New Roman", serif;
  font-weight: 400;
  font-style: italic;
}

/* ── Hero background ────────────────────────────── */

.hero-gradient {
  background: radial-gradient(
      ellipse 80% 60% at 50% 0%,
      rgba(139, 92, 246, 0.08) 0%,
      transparent 70%
    ),
    radial-gradient(
      ellipse 60% 50% at 80% 50%,
      rgba(192, 132, 252, 0.04) 0%,
      transparent 70%
    );
}

.hero-grid {
  background-image: linear-gradient(rgba(255, 255, 255, 0.5) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.5) 1px, transparent 1px);
  background-size: 60px 60px;
}

/* ── Code window (light context) ────────────────── */

.code-window {
  background: #0c0a09;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(255, 255, 255, 0.03);
}

.code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}

.code-content {
  padding: 20px 24px;
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #cbd5e1;
  overflow-x: auto;
  margin: 0;
}

/* ── Code window (dark context) ─────────────────── */

.code-window-dark {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.code-header-dark {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

/* ── Small code window (steps section) ──────────── */

.code-window-sm {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.code-content-sm {
  padding: 14px 18px;
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  line-height: 1.7;
  color: #cbd5e1;
  overflow-x: auto;
  margin: 0;
}

/* ── Agent UI mockup ─────────────────────────────── */

.agent-window {
  background: #111113;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  overflow: hidden;
  box-shadow:
    0 30px 60px -15px rgba(0, 0, 0, 0.6),
    0 0 80px -20px rgba(139, 92, 246, 0.12);
}

.agent-window-header {
  padding: 10px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.agent-window-content {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tool-card {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-left: 2px solid rgba(139, 92, 246, 0.35);
  border-radius: 6px;
  padding: 8px 12px;
  margin-left: 36px;
}

.agent-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

/* ── Agent step transitions ─────────────────────── */

.agent-step-enter-active {
  transition:
    opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.agent-step-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.agent-step-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.agent-step-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ── Status swap (spinner → done) ───────────────── */

.status-swap-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.status-swap-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.status-swap-enter-from {
  opacity: 0;
  transform: scale(0.8);
}

.status-swap-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

/* ── Streaming cursor ────────────────────────────── */

.stream-cursor {
  display: inline-block;
  width: 2px;
  height: 12px;
  background: rgba(139, 92, 246, 0.6);
  margin-left: 1px;
  vertical-align: text-bottom;
  animation: cursor-blink 0.6s step-end infinite;
}

@keyframes cursor-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

/* ── Code glow effect ───────────────────────────── */

.code-glow {
  position: relative;
}

.code-glow::before {
  content: "";
  position: absolute;
  inset: -2px;
  background: linear-gradient(
    135deg,
    rgba(139, 92, 246, 0.25),
    rgba(192, 132, 252, 0.15),
    rgba(139, 92, 246, 0.08)
  );
  border-radius: 14px;
  z-index: -1;
  filter: blur(30px);
  opacity: 0.9;
}

/* ── Syntax highlighting ────────────────────────── */

.hl-kw {
  color: #c084fc;
}
.hl-str {
  color: #86efac;
}
.hl-fn {
  color: #93c5fd;
}
.hl-prop {
  color: #fde68a;
}
.hl-cmt {
  color: #64748b;
  font-style: italic;
}
.hl-num {
  color: #fda4af;
}

/* ── Scroll reveal animations ───────────────────── */

.reveal {
  opacity: 0;
  transform: translateY(24px);
  transition:
    opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
}

.revealed {
  opacity: 1;
  transform: translateY(0);
}

/* ── Tab transition ─────────────────────────────── */

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
