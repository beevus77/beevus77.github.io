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
  if (difficultySelect) difficultySelect.addEventListener('change', newGame);

  newGame();
})();
