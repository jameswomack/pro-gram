# @jameswomack/mluxe

Apple MLX wrapper for local LLM inference on Apple Silicon, callable from Node.js.

## What Is This

mluxe bridges Node.js and Apple's [MLX](https://github.com/ml-explore/mlx) framework, enabling local LLM inference that takes full advantage of Apple Silicon's unified memory architecture and Metal GPU acceleration.

## Architecture

```text
Node.js (TypeScript)
  └── mluxe client
        ├── mlx_lm.server  (OpenAI-compatible HTTP on :8080)
        │     └── Metal GPU — zero-copy unified memory
        └── mlx_lm CLI      (batch generation via child_process)
```

## Modes

1. **Server mode** — Start `mlx_lm.server` and hit its OpenAI-compatible `/v1/chat/completions` endpoint. Drop-in replacement for Ollama with ~15–30% better throughput on Apple Silicon.
2. **CLI mode** — Shell out to `mlx_lm.generate` for one-shot batch inference.
3. **Fine-tune mode** — LoRA/QLoRA via `mlx_lm.lora` and `mlx_lm.fuse` — something Ollama can't do.

## Prerequisites

```bash
# Python 3.11+ with MLX
pip install mlx-lm

# Pull a model (example: Qwen 2.5 14B 4-bit)
python -m mlx_lm.generate --model mlx-community/Qwen2.5-14B-Instruct-4bit --prompt "hello"
```

## Usage

```typescript
import { MluxeClient } from '@jameswomack/mluxe';

const client = new MluxeClient({
  model: 'mlx-community/Qwen2.5-14B-Instruct-4bit',
  port: 8080,
});

await client.startServer();
const response = await client.chat([{ role: 'user', content: 'Hello!' }]);
console.log(response);
```

## Why Not Just Use Ollama?

- **~15–30% faster** on Apple Silicon (native Metal vs llama.cpp)
- **~10–50% less RAM** at same quantization
- **LoRA fine-tuning** built in — train a task-specific model locally
- **Unified memory** — no CPU↔GPU copy overhead

Tradeoff: Mac-only, less polished model management, server not production-hardened. See the full evaluation at `.ai/features/F-001-mlx-runtime-evaluation.md`.
