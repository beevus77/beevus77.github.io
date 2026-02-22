# RL Minesweeper – web assets

- **inference.js**: Encodes board state and runs ONNX policy in the browser.
- **policy.onnx**: Trained policy (not in repo). Generate it with:
  ```bash
  cd ../../rl-minesweeper && pip install -r requirements.txt && python train.py --preset beginner && python export_onnx.py --checkpoint checkpoints/best.pt
  ```
  This writes `policy.onnx` into this directory.
