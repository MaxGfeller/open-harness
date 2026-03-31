import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2025-05-01",

  future: {
    compatibilityVersion: 4,
  },

  modules: ["shadcn-nuxt"],

  shadcn: {
    prefix: "",
    componentDir: "./app/components/ui",
  },

  vite: {
    plugins: [tailwindcss()],
  },

  css: ["~/assets/css/tailwind.css"],

  nitro: {
    preset: "cloudflare_pages",
  },

  app: {
    head: {
      title: "OpenHarness - Build AI Agents in Code",
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        {
          name: "description",
          content:
            "Lightweight, composable building blocks for creating capable AI agents. Built on Vercel AI SDK.",
        },
        {
          property: "og:title",
          content: "OpenHarness - Build AI Agents in Code",
        },
        {
          property: "og:description",
          content:
            "Lightweight, composable building blocks for creating capable AI agents. Built on Vercel AI SDK.",
        },
        { property: "og:type", content: "website" },
        { property: "og:url", content: "https://open-harness.dev" },
      ],
      link: [
        {
          rel: "icon",
          type: "image/svg+xml",
          href: "/favicon.svg",
        },
      ],
    },
  },
});
