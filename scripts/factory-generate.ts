import { join } from 'path';

// Bun-native dynamic generator script for multi-tenant iOS and Web compilation
const args = Bun.argv.slice(2);
const appId = args[0];

if (!appId) {
  console.error('❌ Error: Please specify an application ID. Example: bun run scripts/factory-generate.ts triage-lite');
  process.exit(1);
}

const rootDir = join(import.meta.dir, '..');
const appsJsonPath = join(rootDir, 'apps.json');
const factoryConfigPath = join(rootDir, 'src', 'factory-config.ts');
const capConfigPath = join(rootDir, 'capacitor.config.ts');
const indexHtmlPath = join(rootDir, 'index.html');

// 1. Read apps registry
const appsFile = Bun.file(appsJsonPath);
if (!(await appsFile.exists())) {
  console.error(`❌ Error: Could not find apps registry at ${appsJsonPath}`);
  process.exit(1);
}

const registry = await appsFile.json();
const appConfig = registry.apps[appId];

if (!appConfig) {
  console.error(`❌ Error: Application "${appId}" is not registered in apps.json. Available: ${Object.keys(registry.apps).join(', ')}`);
  process.exit(1);
}

console.log(`🏭 [App Factory] Generating target workspace for "${appConfig.name}"...`);

// 2. Write dynamic src/factory-config.ts
const factoryConfigContent = `// Generated dynamically by the iOS App Factory generator script. Do not modify manually.
export interface AppConfig {
  id: string;
  name: string;
  bundleId: string;
  accentColor: string;
  apiEndpoint: string;
  features: {
    guestMode: boolean;
    pomodoro: boolean;
    haptics: boolean;
  };
}

export const config: AppConfig = ${JSON.stringify(appConfig, null, 2)};
`;

await Bun.write(factoryConfigPath, factoryConfigContent);
console.log(`✅ [App Factory] Updated dynamic config: src/factory-config.ts`);

// 3. Write dynamic capacitor.config.ts
const capConfigContent = `// Generated dynamically by the iOS App Factory generator script. Do not modify manually.
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: ${JSON.stringify(appConfig.bundleId)},
  appName: ${JSON.stringify(appConfig.name)},
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  ios: {
    contentInset: 'always'
  }
};

export default config;
`;

await Bun.write(capConfigPath, capConfigContent);
console.log(`✅ [App Factory] Updated Capacitor config: capacitor.config.ts`);

// 4. Update index.html title tag dynamically
const indexHtmlFile = Bun.file(indexHtmlPath);
if (await indexHtmlFile.exists()) {
  let indexHtmlText = await indexHtmlFile.text();
  indexHtmlText = indexHtmlText.replace(
    /<title>.*<\/title>/,
    `<title>${appConfig.name}</title>`
  );
  await Bun.write(indexHtmlPath, indexHtmlText);
  console.log(`✅ [App Factory] Updated web bundle title in index.html to: "${appConfig.name}"`);
} else {
  console.warn(`⚠️ Warning: Could not find index.html at ${indexHtmlPath}`);
}

console.log(`✨ [App Factory] Generation complete. You can now build or sync the target using standard native commands.`);
