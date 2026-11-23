import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

type Release = {
  tag_name?: string;
  html_url?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
};

const REPOSITORY = "arjun2526/BANTER";
const INSTALLED_BUILD = Number(import.meta.env.VITE_APP_BUILD ?? 0);

export function AppUpdater() {
  const [release, setRelease] = useState<Release | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(false);
  const [opening, setOpening] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    const check = async () => {
      setChecking(true);
      try {
        const response = await fetch(
          `https://api.github.com/repos/${REPOSITORY}/releases/latest`,
          { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" },
        );
        if (!response.ok) throw new Error("Release check failed");
        const latest = (await response.json()) as Release;
        const latestBuild = Number(latest.tag_name?.replace(/^v/, ""));
        const asset = latest.assets?.find((item) => item.name === "BANTER.apk");
        if (active && Number.isFinite(latestBuild) && latestBuild > INSTALLED_BUILD && asset?.browser_download_url) {
          setRelease(latest);
        }
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setChecking(false);
      }
    };
    void check();
    return () => { active = false; };
  }, []);

  if (!release) return null;
  const asset = release.assets?.find((item) => item.name === "BANTER.apk");
  if (!asset?.browser_download_url) return null;

  const latestBuild = release.tag_name?.replace(/^v/, "") ?? "new";
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-5" role="dialog" aria-modal="true" aria-labelledby="banter-update-title">
      <div className="w-full max-w-sm rounded-[28px] border border-[#f07845]/40 bg-[#17120f] p-6 text-[#f5eee8] shadow-2xl">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f07845] text-3xl font-semibold text-[#17120f]">B</div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#f07845]">BANTER UPDATE</p>
        <h2 id="banter-update-title" className="font-display text-3xl">A new version is ready.</h2>
        <p className="mt-3 text-sm leading-6 text-[#c7b9b0]">
          Version {latestBuild} is available with the latest improvements. Download it now to update BANTER.
        </p>
        {error ? <p className="mt-2 text-xs text-[#e9a18a]">Couldn't check for updates. Check your internet connection and reopen BANTER.</p> : null}
        <button
          className="mt-6 w-full rounded-full bg-[#f07845] px-5 py-3 font-semibold text-[#17120f] disabled:opacity-60"
          disabled={checking || opening}
          onClick={async () => {
            setOpening(true);
            setDownloadError(false);
            try {
              await Browser.open({ url: asset.browser_download_url! });
            } catch {
              setDownloadError(true);
              try {
                window.open(asset.browser_download_url!, "_system");
              } catch {
                window.location.href = asset.browser_download_url!;
              }
            } finally {
              setOpening(false);
            }
          }}
        >
          {opening ? "Opening download…" : "Update now"}
        </button>
        <a
          className="mt-3 block w-full rounded-full border border-[#f07845]/50 px-5 py-3 text-center text-sm font-semibold text-[#f5eee8]"
          href={asset.browser_download_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setDownloadError(false)}
        >
          Download link
        </a>
        {downloadError ? <p className="mt-2 text-center text-xs text-[#e9a18a]">The app couldn't open the download automatically. Use the Download link above.</p> : null}
        <p className="mt-3 text-center text-xs leading-5 text-[#9f9188]">
          After downloading, open BANTER.apk and confirm Android's installation prompt.
        </p>
      </div>
    </div>
  );
}
