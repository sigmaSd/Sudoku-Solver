import { serveFile } from "jsr:@std/http@1.0.21/file-server";
import { fromFileUrl, join, normalize } from "jsr:@std/path@1.1.2";
import { python } from "jsr:@sigma/python@0.4.9";

interface Z3Expr {
  toString(): string;
  __eq__(other: Z3Expr): Z3Bool;
}

interface Z3Bool extends Z3Expr {}

interface Z3Int extends Z3Expr {
  __ge__(other: Z3Expr): Z3Bool;
  __le__(other: Z3Expr): Z3Bool;
}

interface Z3CheckResult {
  toString(): string;
}

interface Z3Model {
  evaluate(expr: Z3Expr): Z3Expr;
}

interface Z3Solver {
  add(...constraints: Z3Expr[]): void;
  check(): Z3CheckResult;
  model(): Z3Model;
}

interface Z3 {
  Int(name: string): Z3Int;
  IntVal(value: number): Z3Int;
  Solver(): Z3Solver;
  Distinct(...args: Z3Expr[]): Z3Bool;
  And(...args: Z3Bool[]): Z3Bool;
  Or(...args: Z3Bool[]): Z3Bool;
  Not(expr: Z3Bool): Z3Bool;
}

const z3: Z3 = python.import("z3");

Deno.addSignalListener("SIGINT", () => {
  Deno.exit(0);
});

const GRID_SIZE = 9;
const BOARD_SIZE = GRID_SIZE * GRID_SIZE;

const FRONTEND_ROOT = fromFileUrl(new URL("./frontend", import.meta.url));

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

Deno.serve(
  {
    port: PORT,
    onListen: ({ hostname, port }) => {
      console.log(`Sudoku solver listening on http://${hostname}:${port}`);
    },
  },
  async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);

    if (req.method === "POST" && pathname === "/api/solve") {
      return await handleSolveRequest(req);
    }

    return await serveStaticAsset(req, pathname);
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
    const result = solveSudoku(board);
    return jsonResponse({
      solution: result.solution,
      solutionCount: result.solutionCount,
    });
  } catch (error) {
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

function solveSudoku(
  board: number[],
): { solution: number[]; solutionCount: number } {
  const solver = z3.Solver();
  const cells: Z3Int[] = [];

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const cell = z3.Int(`x_${row}_${col}`);
      cells.push(cell);

      solver.add(cell.__ge__(z3.IntVal(1)));
      solver.add(cell.__le__(z3.IntVal(9)));

      const given = board[row * GRID_SIZE + col];
      if (given !== 0) {
        solver.add(cell.__eq__(z3.IntVal(given)));
      }
    }
  }

  // Row constraints.
  for (let row = 0; row < GRID_SIZE; row++) {
    const rowCells = [];
    for (let col = 0; col < GRID_SIZE; col++) {
      rowCells.push(cells[row * GRID_SIZE + col]);
    }
    solver.add(z3.Distinct(...rowCells));
  }

  // Column constraints.
  for (let col = 0; col < GRID_SIZE; col++) {
    const colCells = [];
    for (let row = 0; row < GRID_SIZE; row++) {
      colCells.push(cells[row * GRID_SIZE + col]);
    }
    solver.add(z3.Distinct(...colCells));
  }

  // Subgrid constraints.
  const BOX_SIZE = 3;
  for (let boxRow = 0; boxRow < BOX_SIZE; boxRow++) {
    for (let boxCol = 0; boxCol < BOX_SIZE; boxCol++) {
      const boxCells = [];
      for (let row = 0; row < BOX_SIZE; row++) {
        for (let col = 0; col < BOX_SIZE; col++) {
          const r = boxRow * BOX_SIZE + row;
          const c = boxCol * BOX_SIZE + col;
          boxCells.push(cells[r * GRID_SIZE + c]);
        }
      }
      solver.add(z3.Distinct(...boxCells));
    }
  }

  const result = solver.check();
  if (result.toString() !== "sat") {
    throw new SudokuUnsolvableError("Sudoku has no solution.");
  }

  const model = solver.model();
  const solution: number[] = [];
  for (const cell of cells) {
    const raw = model.evaluate(cell);
    const value = Number.parseInt(raw.toString(), 10);
    if (!Number.isFinite(value)) {
      throw new Error(`Failed to parse solver value: ${raw.toString()}`);
    }
    solution.push(value);
  }

  // Check if there are multiple solutions by blocking the first one
  const blockConstraints: Z3Bool[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const value = solution[i];
    // Create constraint: cell != value
    const notEqual = z3.Not(cell.__eq__(z3.IntVal(value)));
    blockConstraints.push(notEqual);
  }

  // At least one cell must be different (OR of all differences)
  solver.add(z3.Or(...blockConstraints));

  const nextResult = solver.check();
  const hasMultipleSolutions = nextResult.toString() === "sat";
  const solutionCount = hasMultipleSolutions ? 2 : 1; // 2 means "multiple", not exact count

  return { solution, solutionCount };
}

async function serveStaticAsset(
  req: Request,
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

  const filePath = normalize(join(FRONTEND_ROOT, relativePath));

  if (!filePath.startsWith(FRONTEND_ROOT)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    return await serveFile(req, filePath);
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
