// electron-builder config: per-user NSIS installer, published to GitHub Releases (auto-update source).
// Unsigned beta: no certificate, so no signing is attempted and SmartScreen shows "unknown publisher".
// JS rather than YAML so a local build can reuse the Electron that's already downloaded.
const fs = require('node:fs');
const path = require('node:path');

const localElectron = (() => {
  try {
    const dir = path.join(path.dirname(require.resolve('electron/package.json')), 'dist');
    return fs.existsSync(path.join(dir, 'electron.exe')) ? dir : undefined;
  } catch { return undefined; }
})();

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'app.csbot',
  productName: 'csbot',
  directories: { app: 'build/app', output: 'release', buildResources: 'assets' },
  electronVersion: require('electron/package.json').version,
  ...(localElectron && !process.env.CI ? { electronDist: localElectron } : {}),
  npmRebuild: false,
  asar: true,
  // main.cjs is a full bundle: the app needs no node_modules (electron-builder would otherwise fall back
  // to the workspace's and pack sources and dev files).
  files: ['**/*', '!**/*.map', '!node_modules{,/**/*}'],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/icon.ico',
    // No certificate yet: skip signing, but still write csbot's icon and version info into the exe.
    signExecutable: false,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    artifactName: 'csbot-Setup-${version}.${ext}',
    installerIcon: 'assets/icon.ico',
    uninstallerIcon: 'assets/icon.ico',
    shortcutName: 'csbot',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    include: 'assets/installer.nsh',
  },
  publish: [{ provider: 'github', owner: 'grovic', repo: 'csbot', releaseType: 'release' }],
};
