from __future__ import annotations

import os
from collections.abc import Generator
from typing import Any

from groq import Groq

_GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
_GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
_GROQ_CLIENT: Groq | None = None


def _get_client() -> Groq:
	global _GROQ_CLIENT
	if _GROQ_CLIENT is None:
		_GROQ_CLIENT = Groq(api_key=_GROQ_API_KEY)
	return _GROQ_CLIENT


def summarize_paper(title: str, abstract: str) -> str:
	client = _get_client()
	response = client.chat.completions.create(
		model=_GROQ_MODEL,
		messages=[
			{
				"role": "system",
				"content": "You are a research assistant helping students understand academic papers. Be concise and clear.",
			},
			{
				"role": "user",
				"content": (
					"Please summarize this paper in 4-5 sentences covering: main contribution, "
					"methodology, key findings, and why it matters to students.\n\n"
					f"Title: {title}\n"
					f"Abstract: {abstract}"
				),
			},
		],
		stream=False,
	)
	return (response.choices[0].message.content or "").strip()


def summarize_multiple(papers: list[dict]) -> list[dict]:
	summarized_papers: list[dict] = []

	for paper in papers:
		paper_with_summary = dict(paper)
		try:
			paper_with_summary["summary"] = summarize_paper(
				title=str(paper.get("title", "")),
				abstract=str(paper.get("abstract", "")),
			)
		except Exception:
			paper_with_summary["summary"] = "Summary unavailable."
		summarized_papers.append(paper_with_summary)

	return summarized_papers


def _build_papers_context(papers: list[dict], max_papers: int = 8) -> str:
	context_blocks: list[str] = []
	for idx, paper in enumerate(papers[:max_papers], start=1):
		title = str(paper.get("title", "Untitled"))
		abstract = str(paper.get("abstract", ""))
		context_blocks.append(f"Paper {idx} Title: {title}\nPaper {idx} Abstract: {abstract}")
	return "\n\n".join(context_blocks)


def generate_search_summary(query: str, papers: list[dict]) -> Generator[str, None, None]:
	client = _get_client()
	papers_context = _build_papers_context(papers)

	stream = client.chat.completions.create(
		model=_GROQ_MODEL,
		messages=[
			{
				"role": "system",
				"content": "You synthesize research literature for students in clear, structured language.",
			},
			{
				"role": "user",
				"content": (
					"Given the query and paper snippets below, write a 2-3 paragraph synthesis of "
					"what current research says about this topic. Highlight areas of agreement, "
					"differences in methods or conclusions, and practical takeaways for students.\n\n"
					f"Query: {query}\n\n"
					f"Papers:\n{papers_context}"
				),
			},
		],
		stream=True,
	)

	for chunk in stream:
		delta: Any = chunk.choices[0].delta
		token = getattr(delta, "content", None)
		if token:
			yield token
