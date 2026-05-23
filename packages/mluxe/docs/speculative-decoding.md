# Speculative decoding

A deep dive on the technique behind `MluxeClient`'s `draftModel` /
`numDraftTokens` config and `/ml chat --draft=…`. The summary line in the
shipping docs — *"a small model proposes tokens for the main one to verify in
parallel (~1.5–2× faster output)"* — packs a lot in; this file unpacks it.

## The problem it fixes

When a 14B LLM generates a single token, it has to ream every weight in the
model (~8GB at 4-bit quant) through the GPU's memory pipeline to do one
forward pass. The actual math is fast — Apple Silicon's GPU finishes the
matmuls in single-digit milliseconds. The wall-clock time is dominated by
**memory bandwidth**: how fast the chip can pump those 8GB of weights from
unified memory into the compute units.

Concretely, on an M-series chip generating from Qwen-14B-4bit:

- ~30 tokens/sec output is typical
- ~33ms per token, almost all of which is memory transfer
- Doubling the math work per pass barely changes the wall-clock — the chip is
  sitting on its hands waiting for bytes

This is **memory-bandwidth-bound** generation. Speculative decoding exploits
exactly this slack.

## The core idea

Run a **small model** (the *draft*, ~0.5B params) and a **big model** (the
*target*, 14B) together. The small one is cheap to run autoregressively — its
weights fit easily in cache and its memory transfers are tiny. So you let it
generate, say, 4 tokens ahead in a fraction of the time the big one would
take. Then you call the big model **once**, in a single batched forward pass,
to verify all 4 proposed tokens at the same time.

The trick: a transformer's forward pass over a sequence of N tokens produces
N next-token distributions in roughly the same wall-clock time as producing 1
distribution. The matmuls scale with N, but you're not bottlenecked by
matmuls — you're bottlenecked by weight-streaming, and the weights only have
to come through memory **once per call** regardless of N. So verifying 4
tokens at once is essentially free relative to generating 1.

## The dance, step by step

Say the conversation so far is `"The capital of France is"` and
`--num-draft-tokens=4`.

**Step 1.** Draft (0.5B) generates 4 tokens autoregressively, fast:

```text
"The capital of France is"
  → " Paris"        (draft sample 1)
  → ","             (draft sample 2)
  → " the"          (draft sample 3)
  → " largest"      (draft sample 4)
```

Cost: 4 cheap forward passes on the draft. Maybe 5ms total.

**Step 2.** Target (14B) does **one** forward pass over the original context
plus the 4 proposed tokens — 5 positions in total. Out come 5 probability
distributions: what the *target* would have sampled at each position.

```text
position 0 (after "is"):       target distribution P_t0
position 1 (after " Paris"):   target distribution P_t1
position 2 (after ","):        target distribution P_t2
position 3 (after " the"):     target distribution P_t3
position 4 (after " largest"): target distribution P_t4
```

Cost: one full target forward pass. Maybe 35ms (vs. 4 × 35ms = 140ms if we'd
done it sequentially).

**Step 3.** Walk through the proposed tokens left-to-right with a
rejection-sampling test. For each proposed token `t_i` (which the draft
sampled from its distribution `Q_i`), compare to the target's distribution
`P_t,i` at that position. Compute:

```text
r = P_t,i(t_i) / Q_i(t_i)
```

- If `r >= 1` (target likes the token at least as much as the draft did):
  **accept**.
- If `r < 1`: accept with probability `r`, else **reject**.

If accepted, move to the next proposed token. If rejected at position `k`,
throw away `t_k` and everything after it, then sample a single replacement
token from the *corrected* distribution `(P_t,k − r·Q_k) / (1 − r)` (clipped
to non-negative, renormalized). Stop and start over.

**Step 4.** Bonus token: if all 4 proposed tokens get accepted, you've got 4
confirmed tokens — *and* the target's distribution at position 5 is sitting
right there from the same forward pass. Sample one more for free.

So a fully-accepted round of 4 draft tokens gives you **5 target-quality
tokens** for roughly the cost of one normal step. In the best case that's a
5× speedup on output throughput.

## Why it's mathematically exact

This is the part that surprises people: the resulting token sequence is
statistically **identical** to what the target model would have produced
sampling normally. There's no quality drop, no approximation. The
rejection-sampling math (Chen et al. 2023, *"Accelerating LLM Decoding with
Speculative Sampling"*) is constructed exactly so that the marginal
distribution of accepted tokens matches the target's distribution.

So unlike quantization or distillation, this is a pure speed win — you get
the 14B model's outputs at (closer to) the 0.5B model's speed.

## When you actually see the speedup

Acceptance rate is the swing variable. It depends on how well the small
model agrees with the big one:

- **High agreement** (factual completions, common phrases, structured output,
  code syntax): acceptance rates of 70–90% per token. You realistically get
  3–4 of 4 proposed tokens through, giving the often-quoted 1.5–2× wall-clock
  speedup.
- **Low agreement** (creative writing, divergent reasoning, OOD prompts):
  acceptance can drop to 30–40%. You're paying for the draft's forward passes
  and getting little back. In pathological cases speculative decoding can be
  *slower* than vanilla.

Why `Qwen2.5-0.5B-Instruct-4bit` is the canonical draft for
`Qwen2.5-14B-Instruct-4bit`: same model family, same tokenizer, same
instruction-tuning lineage → high agreement on most chat content. Mixing
families (e.g., Llama draft with Qwen target) tends not to work — distributions
diverge too much and acceptance tanks.

## Memory and CPU cost

- Draft model lives in memory alongside the target. For Qwen 0.5B 4-bit
  that's ~350MB additional — negligible on a Mac Studio.
- The target's forward pass with `1 + num_draft_tokens` positions is slightly
  slower than with 1 (more KV cache to compute, more attention work). For
  `num_draft_tokens=4` the penalty is small; for very high values it starts
  to dominate.
- `num_draft_tokens` is a tuning knob. 4 is `mlx_lm`'s default sweet spot.
  Higher values pay off more on high-agreement content but waste compute on
  low-agreement content.

## Where it lives in this repo

In `MluxeClient` (`packages/mluxe/src/client.ts`), the `draftModel` +
`numDraftTokens` config options get forwarded to `mlx_lm.server` as
`--draft-model <repo> --num-draft-tokens <n>` at spawn time. The server
handles the rejection-sampling loop internally; from the API surface
(OpenAI-compatible `/v1/chat/completions`) you just see faster token streams.

You opt in via `/ml chat --draft=qwen-0.5b` (`apps/cli/src/commands/ml.ts`).
If you set the env var `MLUXE_DRAFT_MODEL=qwen-0.5b` once, every chat session
uses it by default.

## The intuition in one line

Speculative decoding pays a tiny draft-model tax to **fill the
memory-bandwidth slack** in target-model generation, using batched
verification to turn N sequential decisions into one parallel one, with
rejection sampling guaranteeing the output distribution is unchanged.

## References

- Chen, Borgeaud, Irving, Lespiau, Sifre, Jumper (2023). *Accelerating Large
  Language Model Decoding with Speculative Sampling.* arXiv:2302.01318
- Leviathan, Kalman, Matias (2022). *Fast Inference from Transformers via
  Speculative Decoding.* arXiv:2211.17192
- `mlx_lm` source: the `--draft-model` plumbing in
  [`mlx-lm/mlx_lm/server.py`](https://github.com/ml-explore/mlx-lm) and the
  speculative-sampling loop it dispatches to.
