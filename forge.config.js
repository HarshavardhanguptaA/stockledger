module.exports = {
  packagerConfig: {
    name: 'StockLedger',
    executableName: 'stockledger',
    icon: 'assets/logo',
    asar: true,
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'stockledger',
        setupIcon: 'assets/logo.ico',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux'],
    },
  ],
};
