/**
 * afterPack hook for electron-builder.
 * Ad-hoc signs the .app bundle so that macOS Gatekeeper does not flag it as
 * "damaged" on Apple Silicon. This runs AFTER the app is assembled but BEFORE
 * the DMG/ZIP targets are created. We use afterPack (not afterSign) because
 * identity:null skips electron-builder's own signing step entirely.
 */
const { execSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (process.platform !== "darwin") return;

  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`  • ad-hoc signing: ${appPath}`);
  execSync(
    `codesign --force --deep --sign - --entitlements "${path.join(__dirname, "entitlements.mac.plist")}" "${appPath}"`,
    { stdio: "inherit" }
  );
  console.log("  • ad-hoc signing complete");
};
