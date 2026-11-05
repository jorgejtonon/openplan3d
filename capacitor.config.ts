import type { CapacitorConfig } from '@capacitor/cli';

// Android app: the static-site build (STATIC_SITE=1, BASE_PATH empty) packaged in ./site.
const config: CapacitorConfig = {
  appId: 'br.com.engenheirojorgetonon.openplan3d',
  appName: 'OpenPlan3D',
  webDir: 'site',
  android: {
    backgroundColor: '#0f172a',
  },
  plugins: {
    // The pages do not ask for edge-to-edge (no viewport-fit=cover), so the app sits between the
    // status bar and the Android buttons instead of under them; light icons on the dark bars.
    SystemBars: { style: 'DARK', insetsHandling: 'css' },
  },
};

export default config;
