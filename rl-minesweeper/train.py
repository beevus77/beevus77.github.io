"""
Train PPO agent on Minesweeper. Saves checkpoints to checkpoints/.
"""

import os
import argparse
from typing import Tuple
import numpy as np
import torch
from tqdm import tqdm
import torch.nn as nn
import torch.nn.functional as F
from env import MinesweeperEnv, PRESETS
from agent import ActorCritic, build_action_mask


def compute_gae(
    rewards: np.ndarray,
    values: np.ndarray,
    dones: np.ndarray,
    next_value: float,
    next_done: float,
    gamma: float = 0.99,
    lam: float = 0.95,
) -> Tuple[np.ndarray, np.ndarray]:
    """Compute advantages and returns. All shapes (T,) or (T+1,) for values."""
    T = len(rewards)
    advantages = np.zeros(T, dtype=np.float32)
    lastgaelam = 0
    for t in reversed(range(T)):
        if t == T - 1:
            nextnonterminal = 1.0 - next_done
            nextvalue = next_value
        else:
            nextnonterminal = 1.0 - dones[t + 1]
            nextvalue = values[t + 1]
        delta = rewards[t] + gamma * nextvalue * nextnonterminal - values[t]
        advantages[t] = lastgaelam = delta + gamma * lam * lastgaelam * nextnonterminal
    returns = advantages + values[:T]
    return advantages, returns


def train(
    preset: str = "beginner",
    seed: int = 0,
    total_timesteps: int = 500_000,
    n_steps: int = 512,
    batch_size: int = 64,
    n_epochs: int = 4,
    lr: float = 3e-4,
    gamma: float = 0.99,
    gae_lam: float = 0.95,
    clip_coef: float = 0.2,
    ent_coef: float = 0.01,
    vf_coef: float = 0.5,
    max_grad_norm: float = 0.5,
    save_dir: str = "checkpoints",
    device: str = "auto",
) -> None:
    W, H, M = PRESETS[preset]
    n_actions = W * H
    if device == "auto":
        if torch.cuda.is_available():
            device = "cuda"
        elif getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
            device = "mps"  # Apple Silicon GPU
        else:
            device = "cpu"
    device = torch.device(device)
    print(f"Using device: {device}")
    torch.manual_seed(seed)
    np.random.seed(seed)

    env = MinesweeperEnv(width=W, height=H, mines=M, seed=seed)
    model = ActorCritic(n_actions=n_actions, latent_dim=256).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)

    os.makedirs(save_dir, exist_ok=True)
    n_envs = 1
    obs, _ = env.reset(seed=seed)
    obs = np.expand_dims(obs, 0)
    obs = torch.as_tensor(obs, dtype=torch.float32, device=device)
    global_step = 0
    best_mean_reward = -np.inf
    pbar = tqdm(total=total_timesteps, unit="step", unit_scale=True, desc="PPO")

    while global_step < total_timesteps:
        rollout_obs = []
        rollout_actions = []
        rollout_log_probs = []
        rollout_rewards = []
        rollout_dones = []
        rollout_values = []

        for step in range(n_steps):
            action_mask = build_action_mask(obs, n_actions, device)
            with torch.no_grad():
                action, log_prob, value = model.get_action(obs, deterministic=False, action_mask=action_mask)
            action_np = action.cpu().numpy().item()
            obs_np = obs.cpu().numpy()[0]
            next_obs, reward, terminated, truncated, info = env.step(action_np)
            done = terminated or truncated

            rollout_obs.append(obs_np)
            rollout_actions.append(action_np)
            rollout_log_probs.append(log_prob.cpu().numpy().item())
            rollout_rewards.append(reward)
            rollout_dones.append(float(done))
            rollout_values.append(value.cpu().numpy().item())

            global_step += 1
            pbar.update(1)
            if done:
                obs, _ = env.reset()
                obs = np.expand_dims(obs, 0)
            else:
                obs = np.expand_dims(next_obs, 0)
            obs = torch.as_tensor(obs, dtype=torch.float32, device=device)

        with torch.no_grad():
            action_mask = build_action_mask(obs, n_actions, device)
            next_value = model.get_value(obs).cpu().numpy().item()
        next_done = 0.0

        rewards = np.array(rollout_rewards, dtype=np.float32)
        values = np.array(rollout_values, dtype=np.float32)
        dones = np.array(rollout_dones, dtype=np.float32)
        advantages, returns = compute_gae(rewards, values, dones, next_value, next_done, gamma, gae_lam)

        b_obs = torch.as_tensor(np.stack(rollout_obs), dtype=torch.float32, device=device)
        b_actions = torch.as_tensor(np.array(rollout_actions), dtype=torch.long, device=device)
        b_log_probs_old = torch.as_tensor(np.array(rollout_log_probs), dtype=torch.float32, device=device)
        b_advantages = torch.as_tensor(advantages, dtype=torch.float32, device=device)
        b_returns = torch.as_tensor(returns, dtype=torch.float32, device=device)
        b_advantages = (b_advantages - b_advantages.mean()) / (b_advantages.std() + 1e-8)

        n_batches = (n_steps + batch_size - 1) // batch_size
        inds = np.arange(n_steps)
        for _ in range(n_epochs):
            np.random.shuffle(inds)
            for start in range(0, n_steps, batch_size):
                end = min(start + batch_size, n_steps)
                mb_inds = inds[start:end]
                mb_obs = b_obs[mb_inds]
                mb_actions = b_actions[mb_inds]
                mb_log_probs_old = b_log_probs_old[mb_inds]
                mb_advantages = b_advantages[mb_inds]
                mb_returns = b_returns[mb_inds]
                mb_mask = build_action_mask(mb_obs, n_actions, device)

                log_prob, value, entropy = model.evaluate_actions(mb_obs, mb_actions, action_mask=mb_mask)
                ratio = (log_prob - mb_log_probs_old).exp()
                pg_loss1 = mb_advantages * ratio
                pg_loss2 = mb_advantages * torch.clamp(ratio, 1 - clip_coef, 1 + clip_coef)
                pg_loss = -torch.min(pg_loss1, pg_loss2).mean()
                v_loss = F.mse_loss(value, mb_returns)
                entropy_loss = -entropy.mean()
                loss = pg_loss + vf_coef * v_loss + ent_coef * entropy_loss

                optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), max_grad_norm)
                optimizer.step()

        if rollout_rewards:
            mean_reward = np.mean(rollout_rewards)
            wins = sum(1 for r in rollout_rewards if r > 0)
            pbar.set_postfix(mean_r=f"{mean_reward:.3f}", wins=wins, best=f"{best_mean_reward:.3f}", refresh=False)
            if mean_reward > best_mean_reward and np.any(np.array(rollout_rewards) > 0):
                best_mean_reward = mean_reward
                path = os.path.join(save_dir, "best.pt")
                torch.save({"model": model.state_dict(), "preset": preset, "W": W, "H": H, "n_actions": n_actions}, path)
        if global_step % 50_000 == 0 or global_step >= total_timesteps:
            path = os.path.join(save_dir, f"checkpoint_{global_step}.pt")
            torch.save({"model": model.state_dict(), "preset": preset, "W": W, "H": H, "n_actions": n_actions}, path)
            tqdm.write(f"Checkpoint saved: {path}")

    pbar.close()
    path = os.path.join(save_dir, "last.pt")
    torch.save({"model": model.state_dict(), "preset": preset, "W": W, "H": H, "n_actions": n_actions}, path)
    print(f"Done. Saved last to {path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--preset", type=str, default="beginner", choices=list(PRESETS))
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--total-timesteps", type=int, default=500_000)
    parser.add_argument("--n-steps", type=int, default=512)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--save-dir", type=str, default="checkpoints")
    parser.add_argument("--device", type=str, default="auto")
    args = parser.parse_args()
    train(
        preset=args.preset,
        seed=args.seed,
        total_timesteps=args.total_timesteps,
        n_steps=args.n_steps,
        batch_size=args.batch_size,
        lr=args.lr,
        save_dir=args.save_dir,
        device=args.device,
    )
