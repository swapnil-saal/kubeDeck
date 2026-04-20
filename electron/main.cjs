const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const http = require("http");

const isDev = !app.isPackaged;
const PORT = process.env.PORT || 5000;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

function waitForServer(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      http
        .get(url, () => resolve())
        .on("error", () => {
          if (Date.now() > deadline) {
            reject(new Error(`Server did not start within ${timeoutMs}ms`));
            return;
          }
          setTimeout(check, 200);
        });
    };
    check();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#0d1117",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(SERVER_URL);

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(async () => {
  if (!isDev) {
    process.env.NODE_ENV = "production";
    require(path.join(__dirname, "..", "dist", "index.cjs"));
  }

  try {
    await waitForServer(SERVER_URL);
  } catch (err) {
    console.error("Failed to connect to server:", err.message);
    app.quit();
    return;
  }

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
