import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  outDir: 'dist',
  manifest: ({ browser }) => {
    const manifest = {
      name: 'Journey Forge Recorder',
      description: 'Record, review, redact, and upload browser user journeys.',
      permissions: [
        'storage',
        'tabs',
        'activeTab',
        'webRequest',
        'webNavigation',
        'scripting',
        'alarms',
        'downloads',
        'contextMenus'
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
        default_title: 'Journey Forge'
      }
    };

    if (browser === 'chrome') {
      return {
        ...manifest,
        permissions: [...manifest.permissions, 'offscreen', 'tabCapture'],
        side_panel: {
          default_path: 'sidepanel.html'
        }
      };
    }

    return manifest;
  },
  vite: () => ({
    build: { sourcemap: false }
  })
});
