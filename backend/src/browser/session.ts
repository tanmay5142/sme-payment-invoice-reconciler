import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import Browserbase from "@browserbasehq/sdk";

export type BrowserSession = {
  browser: Browser;
  page: Page;
  mode: "local" | "browserbase";
  replayUrl: string | null;
};

export async function openBrowser(): Promise<BrowserSession> {
  const mode = process.env.BROWSER_MODE === "browserbase" ? "browserbase" : "local";

  if (mode === "browserbase") {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    if (!apiKey || !projectId) {
      throw new Error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are missing in .env");
    }
    const bb = new Browserbase({ apiKey });
    const session = await bb.sessions.create({ projectId });
    const browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.newPage());
    return { browser, page, mode, replayUrl: `https://browserbase.com/sessions/${session.id}` };
  }

  // Local mode: a real window you can watch. slowMo makes the clicks easy to follow.
  const browser = await chromium.launch({
    headless: process.env.BROWSER_HEADLESS === "true",
    slowMo: 300,
  });
  const page = await browser.newPage();
  return { browser, page, mode, replayUrl: null };
}