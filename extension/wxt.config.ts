import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  outDir: 'dist',
  manifest: () => ({
    name: 'Journey Forge Local',
    description: 'Local product: record a browser task and upload it to your local Journey Forge server.',
    permissions: [
      'storage',
      'tabs',
      'activeTab',
      'webRequest',
      'webNavigation',
      'scripting',
      'alarms',
      'downloads'
    ],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        resources: ['injected.js'],
        matches: ['<all_urls>']
      }
    ],
    action: {
      default_popup: 'popup.html',
      default_title: 'Journey Forge Local'
    }
  }),
  vite: () => ({
    build: { sourcemap: false }
  })
});
