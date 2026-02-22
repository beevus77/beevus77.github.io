"""
Export the trained policy (actor only) to ONNX for in-browser inference.
Input: (1, 3, H, W) float32. Output: action logits (1, n_actions); we sample in JS.
Observation convention: channel 0 revealed, 1 flagged, 2 adj/9 (9 = unrevealed). Must match JS.
"""

import os
import argparse
import torch
from agent import ActorCritic

# Default: beginner board for web
PRESETS = {"beginner": (9, 9, 10), "intermediate": (16, 16, 40), "expert": (30, 16, 99)}


def export(
    checkpoint_path: str = "checkpoints/best.pt",
    output_path: str = None,
    preset: str = "beginner",
    device: str = "cpu",
) -> None:
    if output_path is None:
        # rl-minesweeper/export_onnx.py -> repo root (Website) -> assets/rl-minesweeper/policy.onnx
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        output_path = os.path.join(repo_root, "assets", "rl-minesweeper", "policy.onnx")
    W, H, M = PRESETS.get(preset, PRESETS["beginner"])
    n_actions = W * H
    ckpt = torch.load(checkpoint_path, map_location=device, weights_only=True)
    if "model" in ckpt:
        state_dict = ckpt["model"]
        if "n_actions" in ckpt:
            n_actions = ckpt["n_actions"]
            W = H = int(n_actions ** 0.5)
            if "W" in ckpt:
                W, H = ckpt["W"], ckpt["H"]
    else:
        state_dict = ckpt
    model = ActorCritic(n_actions=n_actions, latent_dim=256)
    model.load_state_dict(state_dict, strict=True)
    model.eval()

    # Actor only: encoder + actor head. Input (1, 3, H, W) -> output logits (1, n_actions)
    class PolicyOnly(torch.nn.Module):
        def __init__(self, ac):
            super().__init__()
            self.encoder = ac.encoder
            self.actor = ac.actor

        def forward(self, x):
            latent = self.encoder(x)
            return self.actor(latent)

    policy = PolicyOnly(model)
    policy.eval()
    dummy = torch.zeros(1, 3, H, W, dtype=torch.float32)
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    torch.onnx.export(
        policy,
        dummy,
        output_path,
        input_names=["obs"],
        output_names=["logits"],
        dynamic_axes={"obs": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=14,
    )
    print(f"Exported to {output_path} (input shape [1, 3, {H}, {W}], output [1, {n_actions}])")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=str, default="checkpoints/best.pt", help="Path to checkpoint .pt")
    parser.add_argument("--output", type=str, default=None, help="Output .onnx path (default: ../assets/rl-minesweeper/policy.onnx)")
    parser.add_argument("--preset", type=str, default="beginner", choices=list(PRESETS))
    parser.add_argument("--device", type=str, default="cpu")
    args = parser.parse_args()
    export(checkpoint_path=args.checkpoint, output_path=args.output, preset=args.preset, device=args.device)
