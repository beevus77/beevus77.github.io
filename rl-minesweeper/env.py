"""
Minesweeper environment matching the JS game in assets/js/minesweeper.js.
First click is always safe (mines placed after first click, excluding cell + 8 neighbors).
Observation: (3, H, W) - revealed mask, flagged mask, adj count (0-8; 9 = unrevealed).
Action: flat index 0 .. W*H-1 for "reveal cell".
"""

import numpy as np
from typing import Optional, Tuple, Any

# Observation: adj channel uses this value for unrevealed cells (must match JS)
ADJ_UNREVEALED = 9.0

# Presets matching JS (W, H, MINES)
PRESETS = {
    "beginner": (9, 9, 10),
    "intermediate": (16, 16, 40),
    "expert": (30, 16, 99),
}

DIRS = [(dx, dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dx != 0 or dy != 0]


def in_bounds(x: int, y: int, W: int, H: int) -> bool:
    return 0 <= x < W and 0 <= y < H


def idx_of(x: int, y: int, W: int) -> int:
    return y * W + x


class MinesweeperEnv:
    def __init__(
        self,
        width: int = 9,
        height: int = 9,
        mines: int = 10,
        seed: Optional[int] = None,
    ):
        self.W = width
        self.H = height
        self.MINES = mines
        self.n_actions = width * height
        self._rng = np.random.default_rng(seed)
        # Internal state
        self._grid_mine: np.ndarray  # (H*W,) bool
        self._grid_adj: np.ndarray   # (H*W,) int 0-8
        self._revealed: np.ndarray   # (H*W,) bool
        self._flagged: np.ndarray    # (H*W,) bool
        self._first_click: bool = True
        self._revealed_count: int = 0
        self._done: bool = False
        self._won: Optional[bool] = None

    def _place_mines_safe(self, safe_x: int, safe_y: int) -> None:
        protected = set()
        protected.add((safe_x, safe_y))
        for dx, dy in DIRS:
            nx, ny = safe_x + dx, safe_y + dy
            if in_bounds(nx, ny, self.W, self.H):
                protected.add((nx, ny))
        candidates = [
            (x, y)
            for y in range(self.H)
            for x in range(self.W)
            if (x, y) not in protected
        ]
        if len(candidates) < self.MINES:
            candidates = [
                (x, y)
                for y in range(self.H)
                for x in range(self.W)
                if (x, y) != (safe_x, safe_y)
            ]
        self._rng.shuffle(candidates)
        self._grid_mine = np.zeros(self.W * self.H, dtype=bool)
        for i in range(self.MINES):
            x, y = candidates[i]
            self._grid_mine[idx_of(x, y, self.W)] = True
        # Adj counts
        self._grid_adj = np.zeros(self.W * self.H, dtype=np.int32)
        for y in range(self.H):
            for x in range(self.W):
                idx = idx_of(x, y, self.W)
                if self._grid_mine[idx]:
                    continue
                n = 0
                for dx, dy in DIRS:
                    nx, ny = x + dx, y + dy
                    if in_bounds(nx, ny, self.W, self.H) and self._grid_mine[idx_of(nx, ny, self.W)]:
                        n += 1
                self._grid_adj[idx] = n

    def _flood_reveal(self, x: int, y: int) -> None:
        q = [(x, y)]
        seen = {(x, y)}
        while q:
            cx, cy = q.pop(0)
            idx = idx_of(cx, cy, self.W)
            if self._revealed[idx] or self._flagged[idx]:
                continue
            self._revealed[idx] = True
            self._revealed_count += 1
            if self._grid_adj[idx] == 0:
                for dx, dy in DIRS:
                    nx, ny = cx + dx, cy + dy
                    if in_bounds(nx, ny, self.W, self.H) and (nx, ny) not in seen:
                        seen.add((nx, ny))
                        q.append((nx, ny))

    def _obs(self) -> np.ndarray:
        """Observation shape (3, H, W). Channel 0: revealed, 1: flagged, 2: adj (9 = unrevealed)."""
        obs = np.zeros((3, self.H, self.W), dtype=np.float32)
        for y in range(self.H):
            for x in range(self.W):
                idx = idx_of(x, y, self.W)
                obs[0, y, x] = 1.0 if self._revealed[idx] else 0.0
                obs[1, y, x] = 1.0 if self._flagged[idx] else 0.0
                obs[2, y, x] = float(self._grid_adj[idx]) if self._revealed[idx] else ADJ_UNREVEALED
        # Normalize adj to [0,1]: 0-8 -> 0/9 .. 8/9, 9 -> 1.0 or keep 9/9
        obs[2] = obs[2] / 9.0
        return obs

    def reset(
        self,
        *,
        seed: Optional[int] = None,
        options: Optional[dict] = None,
    ) -> Tuple[np.ndarray, dict]:
        if seed is not None:
            self._rng = np.random.default_rng(seed)
        self._revealed = np.zeros(self.W * self.H, dtype=bool)
        self._flagged = np.zeros(self.W * self.H, dtype=bool)
        self._first_click = True
        self._revealed_count = 0
        self._done = False
        self._won = None
        # No mines yet; obs is all zeros (no cells revealed)
        self._grid_mine = np.zeros(self.W * self.H, dtype=bool)
        self._grid_adj = np.zeros(self.W * self.H, dtype=np.int32)
        info = {"revealed_count": 0}
        return self._obs(), info

    def step(self, action: int) -> Tuple[np.ndarray, float, bool, bool, dict]:
        if self._done:
            return self._obs(), 0.0, True, False, {"revealed_count": self._revealed_count}

        action = int(action)
        if action < 0 or action >= self.n_actions:
            return self._obs(), 0.0, False, False, {"revealed_count": self._revealed_count}

        x = action % self.W
        y = action // self.W
        idx = idx_of(x, y, self.W)

        if self._revealed[idx] or self._flagged[idx]:
            # Invalid: already revealed or flagged -> no-op
            return self._obs(), 0.0, False, False, {"revealed_count": self._revealed_count}

        if self._first_click:
            self._first_click = False
            self._place_mines_safe(x, y)
            self._flood_reveal(x, y)
            self._done = False
            safe_total = self.W * self.H - self.MINES
            if self._revealed_count >= safe_total:
                self._done = True
                self._won = True
            return self._obs(), 0.0, self._done, False, {"revealed_count": self._revealed_count}

        if self._grid_mine[idx]:
            self._revealed[idx] = True
            self._revealed_count += 1
            self._done = True
            self._won = False
            return self._obs(), -1.0, True, False, {"revealed_count": self._revealed_count}

        self._flood_reveal(x, y)
        safe_total = self.W * self.H - self.MINES
        if self._revealed_count >= safe_total:
            self._done = True
            self._won = True
            return self._obs(), 1.0, True, False, {"revealed_count": self._revealed_count}

        return self._obs(), 0.0, False, False, {"revealed_count": self._revealed_count}

    def get_obs_shape(self) -> Tuple[int, int, int]:
        return (3, self.H, self.W)


def make_env(preset: str = "beginner", seed: Optional[int] = None) -> MinesweeperEnv:
    W, H, M = PRESETS[preset]
    return MinesweeperEnv(width=W, height=H, mines=M, seed=seed)
