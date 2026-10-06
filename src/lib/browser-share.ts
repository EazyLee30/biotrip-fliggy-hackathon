export type ShareResult = "shared" | "cancelled" | "unsupported" | "failed";
type ShareBrowser = Pick<Navigator, "share" | "canShare">;

/** Call directly from a click handler; preparing a file after the click loses iOS activation. */
export async function shareThroughSystem(browser: ShareBrowser, data: ShareData): Promise<ShareResult> {
  try {
    if (typeof browser.share !== "function") return "unsupported";
    if (data.files?.length && (typeof browser.canShare !== "function" || !browser.canShare({ files: data.files }))) return "unsupported";
    await browser.share(data);
    return "shared"; // The API resolved; this does not prove delivery to a recipient.
  } catch (error) {
    return error && typeof error === "object" && "name" in error && error.name === "AbortError" ? "cancelled" : "failed";
  }
}
