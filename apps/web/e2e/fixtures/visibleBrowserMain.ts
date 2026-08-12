import * as path from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";
import type { BrowserAnnotationEvent, ThreadBrowserState, ThreadId } from "@veylen/contracts";

import {
  BROWSER_SESSION_PARTITION,
  DesktopBrowserManager,
} from "../../../desktop/src/browserManager";
import { BrowserUsePipeServer } from "../../../desktop/src/browserUsePipeServer";
import { BROWSER_IPC_CHANNELS } from "../../../desktop/src/ipcChannels";
import { hardenBrowserAnnotationWebviewPreferences } from "../../../desktop/src/browserAnnotations/webviewSecurity";
import { createBrowserPanelHideScheduler } from "../../src/components/BrowserPanel.logic";

const pipePath = process.env.VEYLEN_BROWSER_HOST_PIPE_PATH;
const capability = process.env.VEYLEN_BROWSER_HOST_CAPABILITY;
const shellPath = process.env.VEYLEN_E2E_SHELL_PATH;
const threadId = process.env.VEYLEN_E2E_THREAD_ID as ThreadId | undefined;
const veylenHome = process.env.VEYLEN_HOME;
const annotationPreloadPath = process.env.VEYLEN_E2E_BROWSER_ANNOTATION_PRELOAD;

if (!pipePath || !capability || !shellPath || !threadId || !veylenHome || !annotationPreloadPath) {
  throw new Error("The visible-browser Electron fixture requires its isolated E2E environment.");
}

app.setPath("userData", path.join(veylenHome, "electron-userdata"));

let physicalMouseTakeoverEnabled = false;
const browserManager = new DesktopBrowserManager({
  annotationPreloadPath,
  beforeInputEvent: () => true,
  beforeMouseEvent: () => !physicalMouseTakeoverEnabled,
});
let mainWindow: BrowserWindow | null = null;
let latestState: ThreadBrowserState | null = null;
let shellReady = false;
let panelRevealEnabled = true;
const annotationEvents: BrowserAnnotationEvent[] = [];
const rendererLifecycleHide = createBrowserPanelHideScheduler();
function setPanelVisible(visible: boolean): void {
  browserManager.setPanelBounds({
    threadId,
    surface: "native",
    bounds: visible ? { x: 0, y: 34, width: 1_000, height: 726 } : null,
  });
  if (!visible) {
    browserManager.hide({ threadId });
    return;
  }
  pushState();
  mainWindow?.webContents.send("veylen-e2e:open-panel");
}
function pushState(): void {
  if (shellReady && latestState && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("veylen-e2e:browser-state", latestState);
  }
}

browserManager.subscribe((state) => {
  latestState = state;
  pushState();
});

ipcMain.on("veylen-e2e:shell-ready", () => {
  shellReady = true;
  pushState();
});

ipcMain.handle(
  "veylen-e2e:attach-webview",
  (event, input: { readonly tabId: string; readonly webContentsId: number }) =>
    browserManager.attachWebview({ threadId, ...input }, event.sender.id),
);
ipcMain.on(BROWSER_IPC_CHANNELS.annotations.guestMessage, (event, payload: unknown) => {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return;
  browserManager.handleAnnotationGuestMessage(event.sender, payload);
});
browserManager.subscribeAnnotationEvents((event) => {
  annotationEvents.push(event);
});

const pipeServer = new BrowserUsePipeServer(browserManager, {
  pipePath,
  capability,
  requestOpenPanel: (requestedThreadId) => {
    if (requestedThreadId !== threadId) throw new Error("Unexpected E2E thread scope.");
    // Exercise React development's setup/cleanup/setup sequence against the
    // real desktop human-control boundary. The remount must cancel the passive
    // cleanup before it can masquerade as a user takeover.
    rendererLifecycleHide.schedule(threadId, () => browserManager.hide({ threadId }));
    rendererLifecycleHide.cancel(threadId);
    if (panelRevealEnabled) setPanelVisible(true);
  },
});

Object.assign(globalThis, {
  __veylenVisibleBrowserE2E: {
    browserManager,
    annotationEvents,
    threadId,
    pipePath,
    setPanelRevealEnabled(enabled: boolean) {
      panelRevealEnabled = enabled;
      setPanelVisible(enabled);
    },
    setPhysicalMouseTakeoverEnabled(enabled: boolean) {
      physicalMouseTakeoverEnabled = enabled;
    },
  },
});

app.whenReady().then(async () => {
  mainWindow = new BrowserWindow({
    width: 1_000,
    height: 760,
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webviewTag: true,
    },
  });
  // Keep ambient workstation input from advancing the human-control epoch
  // while the automated fixture is visible. The takeover coverage below uses
  // webContents.sendInputEvent directly, which remains observable by the real
  // browser runtime without exposing the fixture to unrelated OS pointer use.
  mainWindow.setIgnoreMouseEvents(true);
  browserManager.setWindow(mainWindow);
  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    if (
      !hardenBrowserAnnotationWebviewPreferences({
        partition: params.partition,
        expectedPartition: BROWSER_SESSION_PARTITION,
        preloadPath: annotationPreloadPath,
        webPreferences,
      })
    ) {
      event.preventDefault();
    }
  });
  await mainWindow.loadFile(shellPath);
  await pipeServer.start();
});

app.on("before-quit", () => {
  browserManager.dispose();
  void pipeServer.dispose();
});
