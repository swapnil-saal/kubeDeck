const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const http = require("http");

const PORT = 15173;
let mainWindow = null;

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
