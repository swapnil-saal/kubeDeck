const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const http = require("http");
const { execSync } = require("child_process");

const PORT = 15173;
let mainWindow = null;

/**
 * macOS GUI apps launch without sourcing .zshrc / .zprofile, so KUBECONFIG,
 * auth credential helpers (kubelogin, aws-iam-authenticator, etc.) and any
 * Homebrew-installed tools are missing from the environment.
 *
 * This function spawns a single login shell to capture the user's full env
 * and merges it into process.env so that every subsequent spawn() call
 * (kubectl, helm, …) sees the same environment as an interactive terminal.
 */
function loadShellEnv() {
  const userShell = process.env.SHELL || "/bin/zsh";
  try {
    const raw = execSync(`${userShell} -l -i -c 'printenv' 2>/dev/null`, {
      timeout: 8000,
      encoding: "utf-8",
      // TERM=dumb suppresses p10k instant-prompt and other interactive-terminal
      // checks so the shell starts cleanly without a real TTY attached.
      env: { ...process.env, TERM: "dumb", P9K_DISABLE_CONFIGURATION_WIZARD: "true" },
    });
    for (const line of raw.split("\n")) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1);
      if (!key) continue;
      if (key === "PATH") {
        // Merge shell PATH with whatever Electron already has (de-duplicate)
        const existing = (process.env.PATH || "").split(":");
        const shellPaths = val.split(":");
        const merged = [...new Set([...shellPaths, ...existing])];
        process.env.PATH = merged.join(":");
      } else if (!process.env[key] || key === "KUBECONFIG") {
        // Shell value wins for KUBECONFIG; don't clobber vars Electron set
        process.env[key] = val;
      }
    }
    console.log("[env] Shell environment loaded from", userShell);
  } catch (e) {
    console.warn("[env] Could not load shell environment:", e.message);
    // Fall back to manual common-path augmentation
    const extraPaths = [
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "/usr/bin",
      "/bin",
      path.join(process.env.HOME || "", ".krew", "bin"),
    ];
    const parts = (process.env.PATH || "").split(":");
    for (const p of extraPaths) {
      if (!parts.includes(p)) parts.push(p);
    }
    process.env.PATH = parts.join(":");
  }
}

function waitForServer(url, timeout = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http
        .get(url, (res) => {
          if (res.statusCode === 200 || res.statusCode === 304) resolve();
          else if (Date.now() - start > timeout) reject(new Error("Timeout"));
          else setTimeout(check, 200);
        })
        .on("error", () => {
          if (Date.now() - start > timeout) reject(new Error("Timeout"));
          else setTimeout(check, 200);
        });
    };
    check();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#06080c",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

async function startApp() {
  // Load the user's full login-shell environment (PATH, KUBECONFIG, auth
  // helpers, etc.) before starting the Express server.
  loadShellEnv();

  // Start the Express server
  process.env.PORT = String(PORT);
  process.env.NODE_ENV = "production";
  require(path.join(__dirname, "..", "dist", "index.cjs"));

  const win = createWindow();

  try {
    await waitForServer(`http://localhost:${PORT}/api/k8s/contexts`);
  } catch {
    // Server might still be starting, try loading anyway
    console.log("Server wait timeout, attempting to load...");
  }

  win.loadURL(`http://localhost:${PORT}`);
  win.once("ready-to-show", () => {
    win.show();
  });
}

app.whenReady().then(startApp);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) {
    startApp();
  }
});
