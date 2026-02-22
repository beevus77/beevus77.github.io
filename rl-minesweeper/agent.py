"""
PPO agent with CNN state encoder for Minesweeper.
Observation: (3, H, W). Action: flat 0 .. W*H-1 (reveal cell).
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Tuple, Optional

# Match env: adj unrevealed sentinel normalized to 1.0
ADJ_UNREVEALED_NORM = 1.0  # 9/9


class CNNEncoder(nn.Module):
    """Small CNN: (3, H, W) -> latent. Uses adaptive pool so any H, W work."""

    def __init__(self, latent_dim: int = 256):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(3, 32, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(32, 64, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(64, 64, 3, padding=1),
            nn.ReLU(),
        )
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.fc = nn.Linear(64, latent_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, 3, H, W)
        h = self.conv(x)
        h = self.pool(h)
        h = h.view(h.size(0), -1)
        return self.fc(h)


class ActorCritic(nn.Module):
    """Actor-Critic: shared CNN encoder, policy head (categorical), value head."""

    def __init__(
        self,
        n_actions: int,
        latent_dim: int = 256,
    ):
        super().__init__()
        self.encoder = CNNEncoder(latent_dim=latent_dim)
        self.actor = nn.Linear(latent_dim, n_actions)
        self.critic = nn.Linear(latent_dim, 1)
        self.n_actions = n_actions
        self._latent_dim = latent_dim

    def forward(
        self,
        obs: torch.Tensor,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        latent = self.encoder(obs)
        logits = self.actor(latent)
        value = self.critic(latent).squeeze(-1)
        return logits, value, latent

    def get_value(self, obs: torch.Tensor) -> torch.Tensor:
        latent = self.encoder(obs)
        return self.critic(latent).squeeze(-1)

    def get_action(
        self,
        obs: torch.Tensor,
        deterministic: bool = False,
        action_mask: Optional[torch.Tensor] = None,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        logits, value, latent = self.forward(obs)
        if action_mask is not None:
            logits = logits.masked_fill(~action_mask, -1e9)
        probs = F.softmax(logits, dim=-1)
        if deterministic:
            action = logits.argmax(dim=-1)
        else:
            dist = torch.distributions.Categorical(probs=probs)
            action = dist.sample()
        log_prob = F.log_softmax(logits, dim=-1).gather(1, action.unsqueeze(-1)).squeeze(-1)
        return action, log_prob, value

    def evaluate_actions(
        self,
        obs: torch.Tensor,
        actions: torch.Tensor,
        action_mask: Optional[torch.Tensor] = None,
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        logits, value, latent = self.forward(obs)
        if action_mask is not None:
            logits = logits.masked_fill(~action_mask, -1e9)
        log_prob = F.log_softmax(logits, dim=-1).gather(1, actions.unsqueeze(-1)).squeeze(-1)
        entropy = -(F.softmax(logits, dim=-1) * F.log_softmax(logits, dim=-1)).sum(dim=-1)
        return log_prob, value, entropy


def build_action_mask(obs: torch.Tensor, n_actions: int, device: torch.device) -> torch.Tensor:
    """
    Mask out invalid actions: already revealed (ch0=1) or flagged (ch1=1).
    obs: (B, 3, H, W). Return (B, n_actions) bool, True = valid.
    """
    B, _, H, W = obs.shape
    revealed = obs[:, 0].reshape(B, -1)
    flagged = obs[:, 1].reshape(B, -1)
    valid = (revealed < 0.5) & (flagged < 0.5)
    if valid.shape[1] < n_actions:
        pad = torch.ones(B, n_actions - valid.shape[1], dtype=torch.bool, device=device)
        valid = torch.cat([valid, pad], dim=1)
    elif valid.shape[1] > n_actions:
        valid = valid[:, :n_actions]
    return valid
