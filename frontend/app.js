const GRID_SIZE = 9;
const SUBGRID_SIZE = 3;

const gridInputEl = document.getElementById("grid-input");
const gridSolutionEl = document.getElementById("grid-solution");
const statusEl = document.getElementById("status");
const solveBtn = document.getElementById("solve");
const clearBtn = document.getElementById("clear");

let abortController = null;

if (!gridInputEl || !gridSolutionEl || !statusEl || !solveBtn || !clearBtn) {
  throw new Error("Sudoku UI elements not found in the document.");
}

const inputCells = [];
const solutionCells = [];

function createGrid(containerEl, isInput) {
  const fragment = document.createDocumentFragment();
  const cellsArray = [];

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);

      const subgridAccent =
        (Math.floor(row / SUBGRID_SIZE) + Math.floor(col / SUBGRID_SIZE)) % 2;
      cell.dataset.subgridAccent = subgridAccent ? "1" : "0";

      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "numeric";
      input.maxLength = 1;
      input.autocomplete = "off";
      input.pattern = "[1-9]";
      input.dataset.index = String(row * GRID_SIZE + col);
      input.setAttribute("aria-label", `Row ${row + 1}, Column ${col + 1}`);

      if (isInput) {
        input.addEventListener("input", handleInput);
        input.addEventListener("keydown", handleNavigation);
      } else {
        input.readOnly = true;
        input.tabIndex = -1;
        input.style.cursor = "default";
      }

      cell.appendChild(input);
      cellsArray.push(input);
      fragment.appendChild(cell);
    }
  }

  containerEl.appendChild(fragment);
  return cellsArray;
}

function handleInput(event) {
  const input = event.currentTarget;
  const cleaned = input.value.replace(/[^1-9]/g, "");
  input.value = cleaned.slice(-1);
  input.classList.remove("error");

  if (input.value !== "") {
    moveFocus(Number(input.dataset.index), 0, 1);
  }
}

function handleNavigation(event) {
  const current = Number(event.currentTarget.dataset.index);
  switch (event.key) {
    case "ArrowUp":
      event.preventDefault();
      moveFocus(current, -1, 0);
      break;
    case "ArrowDown":
      event.preventDefault();
      moveFocus(current, 1, 0);
      break;
    case "ArrowLeft":
      event.preventDefault();
      moveFocus(current, 0, -1);
      break;
    case "ArrowRight":
    case "Tab":
      if (event.key === "ArrowRight") {
        event.preventDefault();
      }
      moveFocus(current, 0, 1);
      break;
    case "Backspace":
    case "Delete":
      if (event.currentTarget.value === "") {
        moveFocus(current, 0, -1);
      }
      break;
    default:
      break;
  }
}

function moveFocus(index, rowDelta, colDelta) {
  let row = Math.floor(index / GRID_SIZE);
  let col = index % GRID_SIZE;

  if (rowDelta !== 0) {
    row = (row + rowDelta + GRID_SIZE) % GRID_SIZE;
  }
  if (colDelta !== 0) {
    col = (col + colDelta + GRID_SIZE) % GRID_SIZE;
  }

  const nextIndex = row * GRID_SIZE + col;
  const nextInput = inputCells[nextIndex];
  if (nextInput) {
    nextInput.focus();
    nextInput.select();
  }
}

function readBoard() {
  return inputCells.map((input) => {
    const value = input.value.trim();
    return value === "" ? 0 : Number(value);
  });
}

function writeBoard(board, cellsArray) {
  board.forEach((value, index) => {
    cellsArray[index].value = value ? String(value) : "";
  });
}

function clearBoard() {
  inputCells.forEach((input) => {
    input.value = "";
    input.classList.remove("error");
  });
  solutionCells.forEach((input) => {
    input.value = "";
  });
  setStatus("", null);
  inputCells[0]?.focus();
}

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = type ? `status ${type}` : "status";
}

function highlightConflicts(conflicts) {
  inputCells.forEach((input, index) => {
    if (conflicts.has(index)) {
      input.classList.add("error");
    } else {
      input.classList.remove("error");
    }
  });
}

function findConflicts(board) {
  const conflicts = new Set();

  const checkGroup = (indices) => {
    const seen = new Map();
    for (const idx of indices) {
      const value = board[idx];
      if (value === 0) continue;
      if (seen.has(value)) {
        conflicts.add(idx);
        conflicts.add(seen.get(value));
      } else {
        seen.set(value, idx);
      }
    }
  };

  for (let row = 0; row < GRID_SIZE; row++) {
    const indices = [];
    for (let col = 0; col < GRID_SIZE; col++) {
      indices.push(row * GRID_SIZE + col);
    }
    checkGroup(indices);
  }

  for (let col = 0; col < GRID_SIZE; col++) {
    const indices = [];
    for (let row = 0; row < GRID_SIZE; row++) {
      indices.push(row * GRID_SIZE + col);
    }
    checkGroup(indices);
  }

  for (let boxRow = 0; boxRow < SUBGRID_SIZE; boxRow++) {
    for (let boxCol = 0; boxCol < SUBGRID_SIZE; boxCol++) {
      const indices = [];
      for (let row = 0; row < SUBGRID_SIZE; row++) {
        for (let col = 0; col < SUBGRID_SIZE; col++) {
          const r = boxRow * SUBGRID_SIZE + row;
          const c = boxCol * SUBGRID_SIZE + col;
          indices.push(r * GRID_SIZE + c);
        }
      }
      checkGroup(indices);
    }
  }

  return conflicts;
}

function setLoading(isLoading) {
  if (isLoading) {
    solveBtn.textContent = "Cancel";
    solveBtn.classList.remove("primary");
    solveBtn.classList.add("secondary");
  } else {
    solveBtn.textContent = "Solve";
    solveBtn.classList.remove("secondary");
    solveBtn.classList.add("primary");
  }
  clearBtn.disabled = isLoading;
  inputCells.forEach((input) => {
    input.disabled = isLoading;
  });
}

async function solveSudoku() {
  // If already solving, cancel the current request
  if (abortController) {
    abortController.abort();
    abortController = null;
    setLoading(false);
    setStatus("Cancelled", null);
    return;
  }

  const board = readBoard();
  const conflicts = findConflicts(board);

  if (conflicts.size > 0) {
    highlightConflicts(conflicts);
    setStatus("Please resolve highlighted conflicts before solving.", "error");
    return;
  }

  setStatus("Solving…", null);
  highlightConflicts(new Set());
  setLoading(true);

  abortController = new AbortController();

  try {
    const response = await fetch("/api/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const detail = await safeParseError(response);
      throw new Error(detail || `Solver request failed (${response.status}).`);
    }

    const payload = await response.json();
    if (
      !payload || !Array.isArray(payload.solution) ||
      payload.solution.length !== GRID_SIZE * GRID_SIZE
    ) {
      throw new Error("Solver returned an unexpected response format.");
    }

    writeBoard(payload.solution, solutionCells);

    const solutionCount = payload.solutionCount || 1;
    if (solutionCount === 1) {
      setStatus("Solved! This puzzle has a unique solution.", "success");
    } else {
      setStatus(
        "Solved! This puzzle has multiple solutions. Showing one example.",
        "success",
      );
    }
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("Cancelled", null);
    } else {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unexpected error while solving.",
        "error",
      );
      console.error(error);
    }
  } finally {
    abortController = null;
    setLoading(false);
  }
}

async function safeParseError(response) {
  try {
    const text = await response.text();
    if (!text) return null;
    try {
      const json = JSON.parse(text);
      if (typeof json?.error === "string") return json.error;
      if (typeof json?.message === "string") return json.message;
    } catch {
      return text;
    }
    return text;
  } catch {
    return null;
  }
}

inputCells.push(...createGrid(gridInputEl, true));
solutionCells.push(...createGrid(gridSolutionEl, false));
clearBoard();

solveBtn.addEventListener("click", solveSudoku);
clearBtn.addEventListener("click", () => {
  clearBoard();
  inputCells[0]?.focus();
});
