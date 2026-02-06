(function () {
  'use strict';

  var PRESETS = {
    beginner: { rows: 9, cols: 9, mines: 10 },
    intermediate: { rows: 16, cols: 16, mines: 40 },
    expert: { rows: 16, cols: 30, mines: 99 }
  };

  var app = document.getElementById('minesweeper-app');
  if (!app) return;

  var gridEl = document.getElementById('minesweeper-grid');
  var statusEl = document.getElementById('minesweeper-status');
  var minesEl = document.getElementById('minesweeper-mines');
  var newGameBtn = document.getElementById('minesweeper-new-game');
  var autosolveBtn = document.getElementById('minesweeper-autosolve');
  var difficultySelect = document.getElementById('minesweeper-difficulty');

  var state = {
    rows: 0,
    cols: 0,
    mines: 0,
    mineSet: null,
    cells: null,
    flags: 0,
    revealed: 0,
    started: false,
    over: false,
    timerId: null,
    seconds: 0
  };

  function getPreset() {
    var key = difficultySelect ? difficultySelect.value : 'expert';
    return PRESETS[key] || PRESETS.expert;
  }

  function initBoard() {
    var p = getPreset();
    state.rows = p.rows;
    state.cols = p.cols;
    state.mines = p.mines;
    state.mineSet = null;
    state.cells = [];
    state.flags = 0;
    state.revealed = 0;
    state.started = false;
    state.over = false;
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
    state.seconds = 0;

    for (var r = 0; r < state.rows; r++) {
      state.cells[r] = [];
      for (var c = 0; c < state.cols; c++) {
        state.cells[r][c] = { revealed: false, flagged: false };
      }
    }
  }

  function placeMines(excludeR, excludeC) {
    var set = {};
    var count = 0;
    var max = state.rows * state.cols;
    while (count < state.mines) {
      var r = Math.floor(Math.random() * state.rows);
      var c = Math.floor(Math.random() * state.cols);
      if (r === excludeR && c === excludeC) continue;
      var id = r + ',' + c;
      if (!set[id]) {
        set[id] = true;
        count++;
      }
    }
    state.mineSet = set;
  }

  function isMine(r, c) {
    return state.mineSet && state.mineSet[r + ',' + c];
  }

  function countAdjacentMines(r, c) {
    var n = 0;
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        var nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < state.rows && nc >= 0 && nc < state.cols && isMine(nr, nc)) n++;
      }
    }
    return n;
  }

  function countAdjacentFlags(r, c) {
    var n = 0;
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        var nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < state.rows && nc >= 0 && nc < state.cols && state.cells[nr][nc].flagged) n++;
      }
    }
    return n;
  }

  function getAdjacentHidden(r, c) {
    var out = [];
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        var nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < state.rows && nc >= 0 && nc < state.cols) {
          var cell = state.cells[nr][nc];
          if (!cell.revealed && !cell.flagged) out.push([nr, nc]);
        }
      }
    }
    return out;
  }

  /**
   * Trivial analysis (after David Hill's JSMinesweeper solver).
   * Satisfied tile: number equals adjacent flags -> remaining adjacent are safe to reveal.
   * Full mines: (number - adjacent flags) === count of adjacent hidden -> those hidden are all mines.
   */
  function trivialAnalysis() {
    var toReveal = {};
    var toFlag = {};
    var r, c, cell, num, adjFlags, hidden, i, key;

    for (r = 0; r < state.rows; r++) {
      for (c = 0; c < state.cols; c++) {
        cell = state.cells[r][c];
        if (!cell.revealed || cell.count == null || cell.count === 0) continue;
        num = cell.count;
        adjFlags = countAdjacentFlags(r, c);
        hidden = getAdjacentHidden(r, c);
        if (hidden.length === 0) continue;

        if (adjFlags === num) {
          for (i = 0; i < hidden.length; i++) {
            key = hidden[i][0] + ',' + hidden[i][1];
            toReveal[key] = hidden[i];
          }
        } else if (num - adjFlags === hidden.length) {
          for (i = 0; i < hidden.length; i++) {
            key = hidden[i][0] + ',' + hidden[i][1];
            toFlag[key] = hidden[i];
          }
        }
      }
    }

    var revealList = [];
    for (key in toReveal) revealList.push(toReveal[key]);
    var flagList = [];
    for (key in toFlag) flagList.push(toFlag[key]);

    if (revealList.length === 0 && flagList.length === 0) return null;
    return { toReveal: revealList, toFlag: flagList };
  }

  // --- Full solver (David Hill style): probability engine, 50/50, guessing ---

  var MAX_FRONTIER_FOR_PROB = 22;
  var PROBABILITY_ENGINE_TIMEOUT_MS = 3000;

  function getFrontier() {
    var set = {};
    var r, c, dr, dc, nr, nc, cell;
    for (r = 0; r < state.rows; r++) {
      for (c = 0; c < state.cols; c++) {
        cell = state.cells[r][c];
        if (!cell.revealed && !cell.flagged) continue;
        if (cell.revealed) {
          for (dr = -1; dr <= 1; dr++) {
            for (dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              nr = r + dr; nc = c + dc;
              if (nr >= 0 && nr < state.rows && nc >= 0 && nc < state.cols && !state.cells[nr][nc].revealed && !state.cells[nr][nc].flagged) {
                set[nr + ',' + nc] = [nr, nc];
              }
            }
          }
        }
      }
    }
    var list = [];
    for (var id in set) list.push(set[id]);
    return list;
  }

  function getConstraints(frontierSet) {
    var constraints = [];
    var r, c, cell, need, hidden, indices, i, id;
    for (r = 0; r < state.rows; r++) {
      for (c = 0; c < state.cols; c++) {
        cell = state.cells[r][c];
        if (!cell.revealed || cell.count == null) continue;
        need = cell.count - countAdjacentFlags(r, c);
        hidden = getAdjacentHidden(r, c);
        if (hidden.length === 0) continue;
        indices = [];
        for (i = 0; i < hidden.length; i++) {
          id = hidden[i][0] + ',' + hidden[i][1];
          if (frontierSet[id] !== undefined) indices.push(frontierSet[id]);
        }
        if (indices.length > 0) constraints.push({ indices: indices, need: need });
      }
    }
    return constraints;
  }

  function probabilityEngine(frontier, constraints, remainingMines, otherHiddenCount) {
    var F = frontier.length;
    var O = otherHiddenCount;
    var M = remainingMines;
    var minK = Math.max(0, M - O);
    var maxK = Math.min(F, M);

    var mineCounts = [];
    var i;
    for (i = 0; i < F; i++) mineCounts[i] = 0;
    var totalSolutions = 0;
    var assignment = [];
    var startTime = Date.now();

    function checkConstraints() {
      var c, sum, j;
      for (c = 0; c < constraints.length; c++) {
        sum = 0;
        for (j = 0; j < constraints[c].indices.length; j++) sum += assignment[constraints[c].indices[j]];
        if (sum !== constraints[c].need) return false;
      }
      return true;
    }

    function recurse(idx, placed) {
      if (Date.now() - startTime > PROBABILITY_ENGINE_TIMEOUT_MS) return;
      if (idx === F) {
        if (placed < minK || placed > maxK) return;
        if (!checkConstraints()) return;
        totalSolutions++;
        for (i = 0; i < F; i++) mineCounts[i] += assignment[i];
        return;
      }
      assignment[idx] = 0;
      recurse(idx + 1, placed);
      assignment[idx] = 1;
      recurse(idx + 1, placed + 1);
    }

    recurse(0, 0);

    var probs = {};
    for (i = 0; i < F; i++) {
      var key = frontier[i][0] + ',' + frontier[i][1];
      probs[key] = totalSolutions === 0 ? 0.5 : mineCounts[i] / totalSolutions;
    }
    return { probs: probs, totalSolutions: totalSolutions, mineCounts: mineCounts };
  }

  function find5050(frontier, constraints) {
    var pairs = [];
    var c, inds, need;
    for (c = 0; c < constraints.length; c++) {
      inds = constraints[c].indices;
      need = constraints[c].need;
      if (inds.length === 2 && need === 1) {
        var r0 = frontier[inds[0]][0], c0 = frontier[inds[0]][1];
        var r1 = frontier[inds[1]][0], c1 = frontier[inds[1]][1];
        pairs.push([[r0, c0], [r1, c1]]);
      }
    }
    return pairs;
  }

  function guessingLogic(probs, frontier, frontierSet) {
    var safest = 1;
    var i, j, key, p, r, c, nr, nc, adjKey, maxAdjP, score;
    for (i = 0; i < frontier.length; i++) {
      key = frontier[i][0] + ',' + frontier[i][1];
      p = probs[key];
      if (p < safest) safest = p;
    }
    var cutoff = Math.min(1, safest + 0.1);
    var candidates = [];
    for (i = 0; i < frontier.length; i++) {
      r = frontier[i][0];
      c = frontier[i][1];
      key = r + ',' + c;
      p = probs[key];
      if (p > cutoff) continue;
      maxAdjP = 0;
      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          nr = r + dr;
          nc = c + dc;
          if (nr >= 0 && nr < state.rows && nc >= 0 && nc < state.cols) {
            adjKey = nr + ',' + nc;
            if (probs[adjKey] !== undefined && probs[adjKey] > maxAdjP) maxAdjP = probs[adjKey];
          }
        }
      }
      score = (1 - p) + 0.2 * (1 - maxAdjP);
      candidates.push({ r: r, c: c, p: p, score: score });
    }
    if (candidates.length === 0) return null;
    candidates.sort(function (a, b) { return b.score - a.score; });
    return [candidates[0].r, candidates[0].c];
  }

  function fullSolver(acceptGuesses) {
    var trivial = trivialAnalysis();
    if (trivial && (trivial.toReveal.length > 0 || trivial.toFlag.length > 0)) {
      return { toReveal: trivial.toReveal, toFlag: trivial.toFlag, guess: null, method: 'trivial' };
    }

    var frontier = getFrontier();
    if (frontier.length === 0) return null;

    var frontierSet = {};
    for (var i = 0; i < frontier.length; i++) {
      frontierSet[frontier[i][0] + ',' + frontier[i][1]] = i;
    }
    var constraints = getConstraints(frontierSet);
    var remainingMines = state.mines - state.flags;
    var totalHidden = state.rows * state.cols - state.revealed - state.flags;
    var otherHiddenCount = totalHidden - frontier.length;

    if (frontier.length > MAX_FRONTIER_FOR_PROB) {
      var guessCell = frontier[Math.floor(Math.random() * frontier.length)];
      if (acceptGuesses) return { toReveal: [], toFlag: [], guess: guessCell, method: 'random' };
      return { toReveal: [], toFlag: [], guess: null, method: 'stuck' };
    }

    var result = probabilityEngine(frontier, constraints, remainingMines, otherHiddenCount);
    var probs = result.probs;

    var safeReveal = [];
    var toFlag = [];
    for (i = 0; i < frontier.length; i++) {
      var key = frontier[i][0] + ',' + frontier[i][1];
      var p = probs[key];
      if (p <= 0) safeReveal.push(frontier[i]);
      if (p >= 1) toFlag.push(frontier[i]);
    }
    if (safeReveal.length > 0 || toFlag.length > 0) {
      return { toReveal: safeReveal, toFlag: toFlag, guess: null, method: 'probability' };
    }

    var fifty50 = find5050(frontier, constraints);
    if (fifty50.length > 0) {
      var pick = fifty50[0][0];
      if (acceptGuesses) return { toReveal: [], toFlag: [], guess: pick, method: '50/50' };
      return { toReveal: [], toFlag: [], guess: pick, method: '50/50' };
    }

    var bestGuess = guessingLogic(probs, frontier, frontierSet);
    if (bestGuess && acceptGuesses) {
      return { toReveal: [], toFlag: [], guess: bestGuess, method: 'guessing' };
    }
    if (bestGuess) return { toReveal: [], toFlag: [], guess: bestGuess, method: 'guessing' };
    return null;
  }

  function runAutosolve() {
    if (state.over || !state.mineSet) return;
    startTimer();

    var total = state.rows * state.cols - state.mines;
    var acceptGuesses = true;
    var maxSteps = 500;
    var steps = 0;

    while (!state.over && state.revealed < total && steps < maxSteps) {
      steps++;
      var move = fullSolver(acceptGuesses);
      if (!move) break;

      var i, r, c;
      for (i = 0; i < move.toFlag.length; i++) {
        r = move.toFlag[i][0];
        c = move.toFlag[i][1];
        if (!state.cells[r][c].flagged) {
          state.cells[r][c].flagged = true;
          state.flags++;
        }
      }
      for (i = 0; i < move.toReveal.length; i++) {
        r = move.toReveal[i][0];
        c = move.toReveal[i][1];
        if (!state.cells[r][c].revealed && !state.cells[r][c].flagged) {
          reveal(r, c);
          if (state.over) break;
        }
      }
      if (state.over) break;
      if (move.guess && acceptGuesses) {
        r = move.guess[0];
        c = move.guess[1];
        if (!state.cells[r][c].revealed && !state.cells[r][c].flagged) {
          reveal(r, c);
        }
      } else if (move.guess && !acceptGuesses) {
        if (statusEl) statusEl.textContent = 'No safe move (guess required)';
        break;
      } else if (move.toReveal.length === 0 && move.toFlag.length === 0 && !move.guess) {
        break;
      }
    }

    if (!state.over && state.revealed < total) {
      if (statusEl && statusEl.textContent.indexOf('guess') === -1) {
        statusEl.textContent = 'Solver stuck (try clicking once and Autosolve again)';
      }
    }
    updateStatus();
    render();
  }

  function startTimer() {
    if (state.timerId) return;
    state.timerId = setInterval(function () {
      state.seconds++;
      updateStatus();
    }, 1000);
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function reveal(r, c) {
    if (r < 0 || r >= state.rows || c < 0 || c >= state.cols) return;
    var cell = state.cells[r][c];
    if (cell.revealed || cell.flagged || state.over) return;

    if (!state.mineSet) {
      placeMines(r, c);
      state.started = true;
      startTimer();
    }

    if (isMine(r, c)) {
      state.over = true;
      stopTimer();
      cell.revealed = true;
      cell.exploded = true;
      revealAllMines();
      updateStatus();
      render();
      return;
    }

    cell.revealed = true;
    state.revealed++;
    var count = countAdjacentMines(r, c);
    cell.count = count;

    if (count === 0) {
      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          reveal(r + dr, c + dc);
        }
      }
    }

    var total = state.rows * state.cols - state.mines;
    if (state.revealed >= total) {
      state.over = true;
      stopTimer();
      state.won = true;
    }
    updateStatus();
    render();
  }

  function revealAllMines() {
    for (var r = 0; r < state.rows; r++) {
      for (var c = 0; c < state.cols; c++) {
        if (isMine(r, c)) state.cells[r][c].revealed = true;
      }
    }
  }

  function toggleFlag(r, c) {
    if (state.over) return;
    var cell = state.cells[r][c];
    if (cell.revealed) return;
    cell.flagged = !cell.flagged;
    state.flags += cell.flagged ? 1 : -1;
    updateStatus();
    render();
  }

  function updateStatus() {
    if (!statusEl) return;
    if (state.over) {
      statusEl.textContent = state.won ? 'You win!' : 'Game over';
    } else {
      statusEl.textContent = state.started ? 'Playing' : 'Click to start';
    }
    if (minesEl) {
      minesEl.textContent = 'Mines: ' + (state.mines - state.flags);
      if (state.started && !state.over) {
        minesEl.textContent += ' | Time: ' + state.seconds + 's';
      }
    }
  }

  function render() {
    if (!gridEl) return;
    gridEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = 'repeat(' + state.cols + ', var(--cell-size))';

    for (var r = 0; r < state.rows; r++) {
      for (var c = 0; c < state.cols; c++) {
        var cell = state.cells[r][c];
        var div = document.createElement('div');
        div.className = 'minesweeper__cell';
        div.setAttribute('role', 'gridcell');
        div.dataset.r = r;
        div.dataset.c = c;

        if (state.over) div.classList.add('minesweeper__cell--game-over');
        if (cell.revealed) {
          div.classList.add('minesweeper__cell--revealed');
          if (cell.exploded) {
            div.classList.add('minesweeper__cell--mine', 'minesweeper__cell--exploded');
            div.textContent = '*';
          } else if (isMine(r, c)) {
            div.classList.add('minesweeper__cell--mine');
            div.textContent = '*';
          } else if (cell.count > 0) {
            div.classList.add('minesweeper__cell--num-' + cell.count);
            div.textContent = cell.count;
          }
        } else {
          if (cell.flagged) {
            div.classList.add('minesweeper__cell--flagged');
            div.textContent = 'F';
          }
        }

        gridEl.appendChild(div);
      }
    }
  }

  function handleClick(e) {
    var cell = e.target.closest('.minesweeper__cell');
    if (!cell || state.over) return;
    var r = parseInt(cell.dataset.r, 10);
    var c = parseInt(cell.dataset.c, 10);
    if (e.button === 0) reveal(r, c);
    if (e.button === 2) {
      e.preventDefault();
      toggleFlag(r, c);
    }
  }

  function newGame() {
    initBoard();
    updateStatus();
    render();
  }

  if (gridEl) {
    gridEl.addEventListener('click', function (e) { handleClick(e); });
    gridEl.addEventListener('contextmenu', function (e) { e.preventDefault(); handleClick(e); });
  }
  if (newGameBtn) newGameBtn.addEventListener('click', newGame);
  if (autosolveBtn) autosolveBtn.addEventListener('click', runAutosolve);
  if (difficultySelect) difficultySelect.addEventListener('change', newGame);

  newGame();
})();
