// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  nitro: {
    preset: 'node-server',
    externals: {
      external: ['better-sqlite3']
    },
    experimental: {
      tasks: true
    },
    scheduledTasks: {
      '* * * * *': ['refresh-accounts'],
      '*/15 * * * *': ['refresh-memberships', 'refresh-opencode-modules']
    }
  }
})
