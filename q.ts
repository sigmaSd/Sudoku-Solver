// segfault_exact.ts
// Reproduces the EXACT pattern from your Sudoku solver
// Run with: deno -A segfault_exact.ts

import { python } from "jsr:@denosaurs/python";

console.log("=== Exact Sudoku Pattern Reproduction ===\n");

const z3 = python.import("z3");

console.log("Creating solver with 81 variables (like 9x9 Sudoku)...");
const solver = z3.Solver();
const cells = [];

// Create exactly like Sudoku: 81 variables
for (let i = 0; i < 81; i++) {
  const cell = z3.Int(`x_${i}`);
  cells.push(cell);
  solver.add(cell.__ge__(z3.IntVal(1)));
  solver.add(cell.__le__(z3.IntVal(9)));
  solver.add(cell.__eq__(z3.IntVal((i % 9) + 1))); // Give each a value
}

// Add Distinct constraints (like Sudoku rows)
console.log("Adding Distinct constraints...");
for (let row = 0; row < 9; row++) {
  const rowCells = [];
  for (let col = 0; col < 9; col++) {
    rowCells.push(cells[row * 9 + col]);
  }
  solver.add(z3.Distinct(...rowCells));
}

console.log("First solve...");
const result = solver.check();
console.log(`Result: ${result.toString()}`);

if (result.toString() !== "sat") {
  console.log("Not satisfiable, exiting");
  Deno.exit(0);
}

// Get solution
const model = solver.model();
const solution = [];
console.log("Extracting solution...");
for (const cell of cells) {
  const value = Number.parseInt(model.evaluate(cell).toString(), 10);
  solution.push(value);
}
console.log(`Solution extracted: ${solution.slice(0, 9).join(", ")}...`);

// NOW THE CRITICAL PART: Block the solution (exactly like your code)
console.log("\n=== Creating blocking constraints (CRASH ZONE) ===\n");
const blockConstraints = [];

for (let i = 0; i < cells.length; i++) {
  if (i % 10 === 0) {
    console.log(`Processing cell ${i}/${cells.length}...`);
  }

  const cell = cells[i]; // STALE REFERENCE
  const value = solution[i];

  try {
    // This is where your code crashed
    const intVal = z3.IntVal(value);
    const eqResult = cell.__eq__(intVal); // <-- CRASH HERE
    const notEqual = z3.Not(eqResult);
    blockConstraints.push(notEqual);
  } catch (e) {
    console.error(`\n❌ CRASH at cell ${i}:`, e);
    throw e;
  }
}

console.log("\nAdding Or constraint...");
solver.add(z3.Or(...blockConstraints));

console.log("Second solve...");
const result2 = solver.check();
console.log(`Result: ${result2.toString()}`);

console.log("\n✅ Completed without crash");
