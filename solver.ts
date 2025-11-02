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

const GRID_SIZE = 9;

type SolverInput = {
  board: number[];
};

type SolverOutput =
  | { success: true; solution: number[]; solutionCount: number }
  | { success: false; error: string };

async function readInput(): Promise<SolverInput> {
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];

  for await (const chunk of Deno.stdin.readable) {
    chunks.push(chunk);
  }

  const combined = new Uint8Array(
    chunks.reduce((acc, chunk) => acc + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const text = decoder.decode(combined);
  return JSON.parse(text) as SolverInput;
}

function writeOutput(output: SolverOutput): void {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(output) + "\n");
  Deno.stdout.writeSync(data);
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
    throw new Error("Sudoku has no solution.");
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

async function main() {
  try {
    const input = await readInput();
    const result = solveSudoku(input.board);
    writeOutput({
      success: true,
      solution: result.solution,
      solutionCount: result.solutionCount,
    });
  } catch (error) {
    writeOutput({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

main();
