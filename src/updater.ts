/**
 * Self-update, via the release feed on GitHub.
 *
 * The updater plugin reads `latest.json` from the newest release, compares
 * its version with this build's, and — if the writer agrees — downloads the
 * new installer, checks its signature against the public key in
 * tauri.conf.json, runs it, and relaunches. Everything here is a thin layer
 * over that so the window only deals in "is there one" and "install it".
 */
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export interface AvailableUpdate {
  version: string;
  /** Download, install and relaunch. `onProgress` gets 0–1, or null when
   *  the server didn't say how big the download is. */
  install: (onProgress: (fraction: number | null) => void) => Promise<void>;
}

/** Null when this build is the newest. Throws when the feed can't be reached. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const update = await check();
  if (!update) return null;

  return {
    version: update.version,
    install: async (onProgress) => {
      let total: number | null = null;
      let received = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? null;
            break;
          case "Progress":
            received += event.data.chunkLength;
            onProgress(total ? Math.min(1, received / total) : null);
            break;
          case "Finished":
            onProgress(1);
            break;
        }
      });
      await relaunch();
    },
  };
}
