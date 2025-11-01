import { python } from "jsr:@denosaurs/python";

// TypeScript interface for Z3 API
interface Z3Expr {
  toString(): string;
  __eq__(other: Z3Expr): Z3Expr;
}

interface Z3Bool extends Z3Expr {
}

interface Z3Model {
  evaluate(expr: Z3Bool): Z3Bool;
}

interface Z3CheckResult {
  toString(): string;
}

interface Z3Solver {
  add(constraint: Z3Expr): void;
  check(): Z3CheckResult;
  model(): Z3Model;
  assertions(): Z3Expr[];
}

interface Z3 {
  Bool(name: string): Z3Bool;
  IntVal(value: number): Z3Expr;
  If(condition: Z3Bool, ifTrue: Z3Expr, ifFalse: Z3Expr): Z3Expr;
  Sum(...args: Z3Expr[]): Z3Expr;
  Or(...args: Z3Expr[]): Z3Expr;
  Not(expr: Z3Bool): Z3Expr;
  Solver(): Z3Solver;
}

// Import Z3 Python library
const z3: Z3 = python.import("z3");

console.log("=== Z3 Constraint Satisfaction Problem Solver ===\n");

// Create boolean variables
const a = z3.Bool("a");
const b = z3.Bool("b");
const c = z3.Bool("c");
const d = z3.Bool("d");
const e = z3.Bool("e");
const f = z3.Bool("f");
const g = z3.Bool("g");
const h = z3.Bool("h");
const i = z3.Bool("i");

// Create solver
const solver = z3.Solver();

// Add constraints - exactly one of each group must be true
// (exactly one of: a, b, c) AND (exactly one of: a, d) AND (exactly one of: c, e, f) AND (exactly one of: g, h) AND (exactly one of: g, i)
const constraint1 = z3.Sum(
  z3.If(a, z3.IntVal(1), z3.IntVal(0)),
  z3.If(b, z3.IntVal(1), z3.IntVal(0)),
  z3.If(c, z3.IntVal(1), z3.IntVal(0)),
).__eq__(z3.IntVal(1));
solver.add(constraint1);

const constraint2 = z3.Sum(
  z3.If(a, z3.IntVal(1), z3.IntVal(0)),
  z3.If(d, z3.IntVal(1), z3.IntVal(0)),
).__eq__(z3.IntVal(1));
solver.add(constraint2);

const constraint3 = z3.Sum(
  z3.If(c, z3.IntVal(1), z3.IntVal(0)),
  z3.If(e, z3.IntVal(1), z3.IntVal(0)),
  z3.If(f, z3.IntVal(1), z3.IntVal(0)),
).__eq__(z3.IntVal(1));
solver.add(constraint3);

const constraint4 = z3.Sum(
  z3.If(g, z3.IntVal(1), z3.IntVal(0)),
  z3.If(h, z3.IntVal(1), z3.IntVal(0)),
).__eq__(z3.IntVal(1));
solver.add(constraint4);

const constraint5 = z3.Sum(
  z3.If(g, z3.IntVal(1), z3.IntVal(0)),
  z3.If(i, z3.IntVal(1), z3.IntVal(0)),
).__eq__(z3.IntVal(1));
solver.add(constraint5);

console.log("Constraints (exactly one must be true):");
console.log("  1. exactly one of: a, b, c");
console.log("  2. exactly one of: a, d");
console.log("  3. exactly one of: c, e, f");
console.log("  4. exactly one of: g, h");
console.log("  5. exactly one of: g, i\n");

// Check satisfiability
// Define variables array and names for reuse
const variables = [a, b, c, d, e, f, g, h, i];
const varNames = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];

console.log("Checking satisfiability...");
const result = solver.check();

if (result.toString() === "sat") {
  console.log("✓ SAT - Solution exists!\n");

  // Get model (solution)
  const model = solver.model();

  console.log("Solution:");

  for (let j = 0; j < variables.length; j++) {
    const value = model.evaluate(variables[j]);
    console.log(`  ${varNames[j]} = ${value}`);
  }

  // Find all solutions
  console.log("\n=== Finding All Solutions ===\n");
  let solutionCount = 0;

  while (solver.check().toString() === "sat") {
    solutionCount++;
    const m = solver.model();

    console.log(`Solution ${solutionCount}:`);
    const values: boolean[] = [];

    for (let j = 0; j < variables.length; j++) {
      const val = m.evaluate(variables[j]);
      const isTrue: boolean = val.toString() === "True";
      values.push(isTrue);
      console.log(`  ${varNames[j]} = ${val}`);
    }

    // Block this solution
    const blockClause = z3.Or(
      ...variables.map((v, idx) => values[idx] ? z3.Not(v) : v),
    );
    solver.add(blockClause);
    console.log();
  }

  console.log(`\nTotal unique solutions: ${solutionCount}`);
} else {
  console.log("✗ UNSAT - No solution exists!");
}
