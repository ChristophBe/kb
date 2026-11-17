"""Measures whether reranking beats plain vector similarity on the fixture cases
(tests/fixtures/rerank_cases.json), with the models of a running Ollama:

    uv run --project modules/llm/service python modules/llm/service/eval_rerank.py

Every case has candidate passages and one relevant passage. Passages are ranked
by cosine similarity of their embeddings (what SearchChunks does), then rated by
the chat model, and the hit rate at k (the share of cases whose relevant passage
is among the first k) is compared. Not part of `task test`: it needs models."""

import asyncio
import json
import math
from pathlib import Path

from knowcel_llm.config import Settings
from knowcel_llm.providers import build_provider

KS = (1, 3)
CASES = Path(__file__).parent / "tests" / "fixtures" / "rerank_cases.json"


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    return dot / (math.hypot(*a) * math.hypot(*b))


def rank(scores: list[float]) -> list[int]:
    return sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)


async def main() -> None:
    settings = Settings(llm_provider="ollama")
    provider = build_provider(settings)
    cases = json.loads(CASES.read_text())
    hits = {"similarity": dict.fromkeys(KS, 0), "reranked": dict.fromkeys(KS, 0)}
    for case in cases:
        texts = [case["query"], *case["passages"]]
        query, *passages = await provider.embed(provider.default_embedding_model, texts)
        by_similarity = rank([cosine(query, p) for p in passages])
        ratings = await provider.rerank(
            provider.default_chat_model, case["query"], case["passages"]
        )
        # Ties keep the similarity order, as in the chat module.
        by_rating = sorted(by_similarity, key=lambda i: ratings[i], reverse=True)
        for name, order in (("similarity", by_similarity), ("reranked", by_rating)):
            for k in KS:
                hits[name][k] += case["relevant"] in order[:k]
        print(  # noqa: T201
            f"{case['query'][:55]:55} similarity rank "
            f"{by_similarity.index(case['relevant']) + 1}, reranked rank "
            f"{by_rating.index(case['relevant']) + 1}"
        )
    await provider.aclose()
    models = f"{provider.default_embedding_model} + {provider.default_chat_model}"
    print(f"\ncases: {len(cases)}, models: {models}")  # noqa: T201
    for name, by_k in hits.items():
        rates = ", ".join(f"hit@{k} = {n / len(cases):.2f}" for k, n in by_k.items())
        print(f"{name:11} {rates}")  # noqa: T201


if __name__ == "__main__":
    asyncio.run(main())
