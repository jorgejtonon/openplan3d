import type { CapacitorConfig } from '@capacitor/cli';

// Android app: the static-site build (STATIC_SITE=1, BASE_PATH empty) packaged in ./site.
const config: CapacitorConfig = {
  appId: 'br.com.engenheirojorgetonon.openplan3d',
  appName: 'OpenPlan3D',
  webDir: 'site',
  android: {
    backgroundColor: '#0f172a',
  },
};

export default config;
