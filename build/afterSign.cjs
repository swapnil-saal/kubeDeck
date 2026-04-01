/**
 * afterSign hook for electron-builder.
 * Re-signs the entire .app bundle deeply with an ad-hoc identity so that
 * the main binary and the pre-built Electron Framework both carry the same
 * (empty) Team ID.  Without this step macOS 15+ / 26.x rejects the app at
 * launch with "different Team IDs".
 */
const { execSync } = require("child_process");
const path = require("path");

exports.default = async function afterSign(context) {
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productName;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`  • deep ad-hoc re-signing: ${appPath}`);
  execSync(`codesign --deep --force --sign - "${appPath}"`, {
    stdio: "inherit",
  });
  console.log("  • re-signing complete");
};
