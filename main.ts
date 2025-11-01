import { serveFile } from "https://deno.land/std@0.224.0/http/file_server.ts";
import { fromFileUrl, join, normalize } from "https://deno.land/std@0.224.0/path/mod.ts";
import { python } from "jsr:@denosaurs/python";

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

console.log("Importing z3...");
const z3: Z3 = python.import("z3");
console.log("z3 imported successfully");

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
    return jsonResponse({ solution: result.solution, solutionCount: result.solutionCount });
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

function solveSudoku(board: number[]): { solution: number[]; solutionCount: number } {
  console.log("Creating solver...");
  const solver = z3.Solver();
  console.log("Solver created");

  const cells: Z3Int[] = [];
  const cellNames: string[] = []; // Store names for fresh references later

  console.log("Setting up cells and constraints...");
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const cellName = `x_${row}_${col}`;
      console.log(`Creating cell ${cellName}`);
      const cell = z3.Int(cellName);
      console.log(`Cell created: ${cellName}`);
      cells.push(cell);
      cellNames.push(cellName); // Store name

      console.log(`Adding range constraints for ${cellName}`);
      const one = z3.IntVal(1);
      console.log("Created IntVal(1)");
      const geConstraint = cell.__ge__(one);
      console.log("Created >= constraint");
      solver.add(geConstraint);
      console.log("Added >= constraint");

      const nine = z3.IntVal(9);
      console.log("Created IntVal(9)");
      const leConstraint = cell.__le__(nine);
      console.log("Created <= constraint");
      solver.add(leConstraint);
      console.log("Added <= constraint");

      const given = board[row * GRID_SIZE + col];
      if (given !== 0) {
        console.log(`Adding given value ${given} for ${cellName}`);
        const givenVal = z3.IntVal(given);
        console.log(`Created IntVal(${given})`);
        const eqConstraint = cell.__eq__(givenVal);
        console.log("Created == constraint");
        solver.add(eqConstraint);
        console.log("Added == constraint");
      }
    }
  }

  console.log("Adding row constraints...");
  // Row constraints.
  for (let row = 0; row < GRID_SIZE; row++) {
    console.log(`Processing row ${row}`);
    const rowCells = [];
    for (let col = 0; col < GRID_SIZE; col++) {
      rowCells.push(cells[row * GRID_SIZE + col]);
    }
    console.log(`Creating Distinct for row ${row}`);
    const distinctConstraint = z3.Distinct(...rowCells);
    console.log(`Adding Distinct constraint for row ${row}`);
    solver.add(distinctConstraint);
  }

  console.log("Adding column constraints...");
  // Column constraints.
  for (let col = 0; col < GRID_SIZE; col++) {
    console.log(`Processing column ${col}`);
    const colCells = [];
    for (let row = 0; row < GRID_SIZE; row++) {
      colCells.push(cells[row * GRID_SIZE + col]);
    }
    console.log(`Creating Distinct for column ${col}`);
    const distinctConstraint = z3.Distinct(...colCells);
    console.log(`Adding Distinct constraint for column ${col}`);
    solver.add(distinctConstraint);
  }

  console.log("Adding subgrid constraints...");
  // Subgrid constraints.
  const BOX_SIZE = 3;
  for (let boxRow = 0; boxRow < BOX_SIZE; boxRow++) {
    for (let boxCol = 0; boxCol < BOX_SIZE; boxCol++) {
      console.log(`Processing box ${boxRow},${boxCol}`);
      const boxCells = [];
      for (let row = 0; row < BOX_SIZE; row++) {
        for (let col = 0; col < BOX_SIZE; col++) {
          const r = boxRow * BOX_SIZE + row;
          const c = boxCol * BOX_SIZE + col;
          boxCells.push(cells[r * GRID_SIZE + c]);
        }
      }
      console.log(`Creating Distinct for box ${boxRow},${boxCol}`);
      const distinctConstraint = z3.Distinct(...boxCells);
      console.log(`Adding Distinct constraint for box ${boxRow},${boxCol}`);
      solver.add(distinctConstraint);
    }
  }

  console.log("Checking satisfiability...");
  const result = solver.check();
  console.log(`Check result: ${result.toString()}`);

  if (result.toString() !== "sat") {
    throw new SudokuUnsolvableError("Sudoku has no solution.");
  }

  console.log("Getting model...");
  const model = solver.model();
  console.log("Model obtained");

  const solution: number[] = [];
  console.log("Extracting solution values...");
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    console.log(`Evaluating cell ${i}`);
    const raw = model.evaluate(cell);
    console.log(`Cell ${i} raw value: ${raw.toString()}`);
    const value = Number.parseInt(raw.toString(), 10);
    if (!Number.isFinite(value)) {
      throw new Error(`Failed to parse solver value: ${raw.toString()}`);
    }
    solution.push(value);
  }

  console.log("Checking for multiple solutions...");
  // Check if there are multiple solutions by blocking the first one
  const blockConstraints: Z3Bool[] = [];
  for (let i = 0; i < cellNames.length; i++) {
    const value = solution[i];
    console.log(`Creating block constraint for cell ${i} (${cellNames[i]}), value ${value}`);

    // FIX: Create fresh cell reference instead of reusing old cell objects
    console.log(`  Creating fresh cell variable: ${cellNames[i]}`);
    const freshCell = z3.Int(cellNames[i]);
    console.log(`  Created fresh cell`);

    console.log(`  Creating IntVal(${value})`);
    const intVal = z3.IntVal(value);
    console.log(`  Created IntVal: ${intVal.toString()}`);

    console.log(`  Calling __eq__ on fresh cell`);
    const eqResult = freshCell.__eq__(intVal);
    console.log(`  Got eq result: ${eqResult.toString()}`);

    console.log(`  Calling Not`);
    const notEqual = z3.Not(eqResult);
    console.log(`  Got notEqual: ${notEqual.toString()}`);

    blockConstraints.push(notEqual);
  }

  console.log("Creating Or of block constraints...");
  const orConstraint = z3.Or(...blockConstraints);
  console.log("Adding Or constraint to solver...");
  solver.add(orConstraint);

  console.log("Checking for second solution...");
  const nextResult = solver.check();
  console.log(`Second check result: ${nextResult.toString()}`);

  const hasMultipleSolutions = nextResult.toString() === "sat";
  const solutionCount = hasMultipleSolutions ? 2 : 1;

  console.log(`Solution found with count: ${solutionCount}`);
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
