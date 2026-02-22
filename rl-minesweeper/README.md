# RL Minesweeper (PPO + CNN)

Train a PPO agent with a CNN state encoder for Minesweeper, then export the policy to ONNX for in-browser inference on the website.

## Observation format (Python and JS must match)

- **Shape**: `(3, H, W)` in PyTorch; `[1, 3, H, W]` for ONNX (batch first).
- **Channels**:
  - 0: revealed mask (0 or 1).
  - 1: flagged mask (0 or 1).
  - 2: adjacent mine count for revealed cells, normalized to `[0, 1]` as `adj/9`; **unrevealed cells use value 1.0** (sentinel 9/9).
- All values float32 in `[0, 1]`.

## Action format

- **Action space**: flat index `0 .. W*H - 1` (row-major: `index = y * W + x`).
- **Meaning**: reveal the cell at `(index % W, index // W)`.
- Invalid actions (already revealed or flagged) are masked out during training; the JS side should only request an action when at least one valid cell exists, and can mask or re-sample if needed.

## Setup

```bash
cd rl-minesweeper
pip install -r requirements.txt
```

## Train

```bash
python train.py --preset beginner --total-timesteps 500000 --save-dir checkpoints
```

Checkpoints are saved under `checkpoints/` (e.g. `best.pt`, `last.pt`).

## Export to ONNX

After training, export the policy for the web:

```bash
python export_onnx.py --checkpoint checkpoints/best.pt --preset beginner
```

This writes `../assets/rl-minesweeper/policy.onnx`. The default preset is `beginner` (9×9); use `--preset intermediate` or `--preset expert` to export for other board sizes (you need a checkpoint trained for that size).

## Presets

| Preset        | W   | H  | Mines |
|---------------|-----|----|-------|
| beginner      | 9   | 9  | 10    |
| intermediate  | 16  | 16 | 40    |
| expert        | 30  | 16 | 99    |

The website loads `policy.onnx` and runs inference in the browser with the same observation encoding.
