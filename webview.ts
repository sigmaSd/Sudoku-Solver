import { SizeHint, Webview } from "jsr:@webview/webview@0.9.0";
import { AdwApp } from "jsr:@sigmasd/adw-app@0.1.3";

if (import.meta.main) {
  const worker = new Worker(import.meta.resolve("./main.ts"), {
    type: "module",
  });
  const port = await new Promise<number>((resolve) => {
    worker.onmessage = (e) => {
      const { port } = e.data;
      resolve(port);
    };
  });

  const app = new AdwApp({ id: "io.github.sigmasd.sudoku-solver" });
  app.run((window) => {
    const webview = new Webview(false, undefined, window);
    webview.title = "Sudoku Solver";
    webview.size = { width: 1200, height: 700, hint: SizeHint.NONE };

    webview.navigate(`http://localhost:${port}`);
  });
  worker.terminate();
  Deno.exit(0);
}
