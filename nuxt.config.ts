// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  nitro: {
    experimental: {
      tasks: true
    },
    scheduledTasks: {
      '*/5 * * * *': ['refresh-accounts']
    },
    externals: {
      traceInclude: ['better-sqlite3']
    }
  },
  vite: {
    optimizeDeps: {
      exclude: ['better-sqlite3']
    }
  }
})
