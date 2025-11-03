/// <reference lib="webworker" />

Deno.addSignalListener("SIGINT", () => {
  Deno.exit(0);
});

const GRID_SIZE = 9;
const BOARD_SIZE = GRID_SIZE * GRID_SIZE;

const FRONTEND_ROOT = import.meta.resolve("./frontend/");
const SOLVER_PATH = import.meta.resolve("./solver.ts");

const PORT = Number(Deno.env.get("PORT") ?? "8000");
if (!Number.isInteger(PORT) || PORT <= 0) {
  throw new Error(`Invalid PORT value: ${Deno.env.get("PORT")}`);
}

type SolveRequest = {
  board: unknown;
};

type SolveResponse =
  | { solution: number[]; solutionCount: number }
  | { error: string };

type SolverOutput =
  | { success: true; solution: number[]; solutionCount: number }
  | { success: false; error: string };

Deno.serve(
  {
    port: 0,
    onListen: ({ hostname, port }) => {
      console.log(`Sudoku solver listening on http://${hostname}:${port}`);
      if (isRunningInWorker()) {
        self.postMessage({ port });
      }
    },
  },
  async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);

    if (req.method === "POST" && pathname === "/api/solve") {
      return await handleSolveRequest(req);
    }

    return await serveStaticAsset(pathname);
  },
);

async function handleSolveRequest(req: Request): Promise<Response> {
  let payload: SolveRequest;

  try {
    payload = await req.json() as SolveRequest;
  } catch {
    return jsonError("Invalid JSON payload.", 400);
  }

  if (!Array.isArray(payload.board)) {
    return jsonError("Expected `board` to be an array of numbers.", 400);
  }

  if (payload.board.length !== BOARD_SIZE) {
    return jsonError(`Expected board length ${BOARD_SIZE}.`, 400);
  }

  const board: number[] = [];
  for (const value of payload.board) {
    if (
      typeof value !== "number" || !Number.isInteger(value) ||
      value < 0 || value > 9
    ) {
      return jsonError("Board entries must be integers in the range 0-9.", 400);
    }
    board.push(value);
  }

  try {
    const result = await solveSudokuInProcess(board, req.signal);
    return jsonResponse({
      solution: result.solution,
      solutionCount: result.solutionCount,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return jsonError("Request was cancelled.", 499);
    }
    if (error instanceof SudokuUnsolvableError) {
      return jsonError("The provided Sudoku board is unsatisfiable.", 422);
    }
    console.error("Solver error", error);
    return jsonError("Internal solver error.", 500);
  }
}

class SudokuUnsolvableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SudokuUnsolvableError";
  }
}

async function solveSudokuInProcess(
  board: number[],
  signal: AbortSignal,
): Promise<{ solution: number[]; solutionCount: number }> {
  // Spawn a new Deno process for each solve request
  const command = new Deno.Command(Deno.execPath(), {
    args: ["-A", SOLVER_PATH],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });

  const process = command.spawn();

  // Set up abort handler to kill the process
  const abortHandler = () => {
    try {
      process.kill("SIGTERM");
    } catch {
      // Process may have already exited
    }
  };

  if (signal.aborted) {
    abortHandler();
    throw new DOMException("Request was aborted", "AbortError");
  }

  signal.addEventListener("abort", abortHandler);

  try {
    // Write the board to stdin
    const writer = process.stdin.getWriter();
    const encoder = new TextEncoder();
    const input = JSON.stringify({ board });
    await writer.write(encoder.encode(input));
    await writer.close();

    // Read the output
    const { code, stdout, stderr } = await process.output();

    if (signal.aborted) {
      throw new DOMException("Request was aborted", "AbortError");
    }

    if (code !== 0) {
      const stderrText = new TextDecoder().decode(stderr);
      console.error("Solver process failed:", stderrText);
      throw new Error(`Solver process exited with code ${code}`);
    }

    const stdoutText = new TextDecoder().decode(stdout);
    const output = JSON.parse(stdoutText.trim()) as SolverOutput;

    if (!output.success) {
      throw new SudokuUnsolvableError(output.error);
    }

    return {
      solution: output.solution,
      solutionCount: output.solutionCount,
    };
  } finally {
    signal.removeEventListener("abort", abortHandler);
  }
}

async function serveStaticAsset(
  pathname: string,
): Promise<Response> {
  let relativePath = pathname;

  if (relativePath === "/" || relativePath === "") {
    relativePath = "index.html";
  } else {
    relativePath = relativePath.replace(/^\/+/g, "");
  }

  if (relativePath.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = new URL(relativePath, FRONTEND_ROOT).href;

  if (!filePath.startsWith(FRONTEND_ROOT)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const resp = await fetch(filePath);
    return new Response(resp.body, {
      headers: {
        "content-type": filePath.endsWith(".html")
          ? "text/html; charset=utf-8"
          : filePath.endsWith(".css")
          ? "text/css"
          : filePath.endsWith(".js")
          ? "application/javascript"
          : resp.headers.get("content-type") || "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function jsonResponse(data: SolveResponse, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function jsonError(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

function isRunningInWorker() {
  return (
    typeof DedicatedWorkerGlobalScope !== "undefined" &&
    self instanceof DedicatedWorkerGlobalScope
  );
}
