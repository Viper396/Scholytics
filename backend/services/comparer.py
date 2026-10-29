from __future__ import annotations

import json
import logging
import re
from typing import Any

from pydantic import BaseModel, Field

from services.summarizer import _get_client, _get_model_name

logger = logging.getLogger(__name__)

_MIN_COMPARE_PAPERS = 2
_MAX_COMPARE_PAPERS = 4
_MAX_ABSTRACT_CHARS = 1200
_MAX_TITLE_CHARS = 200

_JSON_EXTRACTOR = re.compile(r"\{.*\}", re.DOTALL)


class PaperComparisonItem(BaseModel):
	arxiv_id: str
	title: str
	entry_url: str
	pdf_url: str
	authors: list[str] = Field(default_factory=list)
	published: str = ""
	research_question: str
	method: str
	datasets_or_setup: str
	reported_findings: str
	limitations: str


class ComparisonResult(BaseModel):
	papers: list[PaperFeatureComparison]
	similarities: list[str] = Field(default_factory=list)
	differences: list[str] = Field(default_factory=list)
	research_gaps: list[str] = Field(default_factory=list)
	disclaimer: str


class PaperFeatureComparison(BaseModel):
	arxiv_id: str
	title: str
	entry_url: str
	pdf_url: str
	authors: list[str] = Field(default_factory=list)
	published: str = ""
	research_question: str
	method: str
	datasets_or_setup: str
	reported_findings: str
	limitations: str


ComparisonResult.model_rebuild()


def _sanitize_text_field(value: Any, default: str = "Not explicitly reported in abstract") -> str:
	if not value or not str(value).strip():
		return default
	cleaned = str(value).strip()
	# Check for empty-like placeholders
	if cleaned.lower() in ("n/a", "none", "unknown", "not stated", "not reported", "not mentioned"):
		return default
	return cleaned


def _clean_json_response(raw_text: str) -> dict[str, Any]:
	"""Extract and parse JSON object from LLM completion string."""
	raw = raw_text.strip()
	try:
		return json.loads(raw)
	except json.JSONDecodeError:
		match = _JSON_EXTRACTOR.search(raw)
		if match:
			return json.loads(match.group(0))
		raise ValueError("Model output did not contain a valid JSON object")


def compare_papers(
	papers: list[dict[str, Any]],
	query: str | None = None,
) -> ComparisonResult:
	"""
	Generate a structured, evidence-grounded comparative matrix for 2 to 4 papers.

	Parameters
	----------
	papers : list[dict[str, Any]]
		Candidate papers containing 'arxiv_id', 'title', 'abstract', etc.
	query : str | None
		Optional context query.

	Returns
	-------
	ComparisonResult
		Structured comparison model with validated paper IDs and authentic URLs.
	"""
	if len(papers) < _MIN_COMPARE_PAPERS:
		raise ValueError(f"At least {_MIN_COMPARE_PAPERS} papers are required for comparison (received {len(papers)})")

	# Bounded input subset (max 4 papers) to respect context and token limits
	eval_papers = papers[:_MAX_COMPARE_PAPERS]

	# Build canonical input map
	input_map: dict[str, dict[str, Any]] = {}
	context_blocks: list[str] = []

	for idx, p in enumerate(eval_papers, start=1):
		aid = str(p.get("arxiv_id", f"paper-{idx}")).strip()
		title = str(p.get("title", "Untitled")).strip()[:_MAX_TITLE_CHARS]
		abstract = str(p.get("abstract", "")).strip()[:_MAX_ABSTRACT_CHARS]
		entry_url = str(p.get("entry_url", f"https://arxiv.org/abs/{aid}")).strip()
		pdf_url = str(p.get("pdf_url", f"https://arxiv.org/pdf/{aid}")).strip()
		published = str(p.get("published", "")).strip()

		authors_raw = p.get("authors") or []
		if isinstance(authors_raw, str):
			authors = [a.strip() for a in authors_raw.split(",") if a.strip()]
		elif isinstance(authors_raw, list):
			authors = [str(a).strip() for a in authors_raw if str(a).strip()]
		else:
			authors = []

		record = {
			"arxiv_id": aid,
			"title": title,
			"abstract": abstract or "[Abstract not provided]",
			"entry_url": entry_url,
			"pdf_url": pdf_url,
			"authors": authors[:5],
			"published": published,
		}
		input_map[aid] = record

		context_blocks.append(
			f"--- PAPER {idx} ---\n"
			f"ID: {aid}\n"
			f"Title: {title}\n"
			f"Abstract: {record['abstract']}\n"
		)

	papers_context = "\n".join(context_blocks)

	client = _get_client()
	model_name = _get_model_name()

	system_prompt = (
		"You are an expert scientific literature analyst. Your task is to produce a structured, "
		"evidence-grounded comparative matrix of academic research papers based strictly on their abstracts.\n\n"
		"Strict Grounding Rules:\n"
		"1. Extract information ONLY from the provided paper abstracts. Do NOT invent, assume, or extrapolate findings, datasets, or experimental metrics.\n"
		"2. If a specific dimension (e.g. dataset, experimental setup, or limitation) is not explicitly stated in an abstract, you MUST record it as 'Not explicitly reported in abstract'.\n"
		"3. Clearly associate each paper's features with its exact ID provided in the prompt.\n"
		"4. Research Gaps must represent potential opportunities or unaddressed limitations derived directly from the stated evidence, framed as model interpretations.\n"
		"5. Output strictly a JSON object with keys: 'papers', 'similarities', 'differences', 'research_gaps'."
	)

	user_prompt = (
		f"Compare the following {len(eval_papers)} research papers"
		+ (f" in the context of query: \"{query.strip()}\"" if query and query.strip() else "")
		+ ":\n\n"
		f"{papers_context}\n\n"
		"Provide a JSON object adhering to this structure:\n"
		"{\n"
		"  \"papers\": [\n"
		"    {\n"
		"      \"arxiv_id\": \"<exact ID>\",\n"
		"      \"research_question\": \"<primary research objective or question in 1-2 sentences>\",\n"
		"      \"method\": \"<proposed method, architecture, or algorithm in 1-2 sentences>\",\n"
		"      \"datasets_or_setup\": \"<stated datasets, benchmarks, or setup, or 'Not explicitly reported in abstract'>\",\n"
		"      \"reported_findings\": \"<key empirical or theoretical findings stated in abstract>\",\n"
		"      \"limitations\": \"<limitations explicitly stated by authors, or 'Not explicitly stated in abstract'>\"\n"
		"    }\n"
		"  ],\n"
		"  \"similarities\": [\"<shared premise, common technique, or consensus point>\"],\n"
		"  \"differences\": [\"<contrasting technique, differing experimental goal, or divergent finding>\"],\n"
		"  \"research_gaps\": [\"<potential research gap or open direction derived from reported limitations>\"]\n"
		"}"
	)

	response = client.chat.completions.create(
		model=model_name,
		messages=[
			{"role": "system", "content": system_prompt},
			{"role": "user", "content": user_prompt},
		],
		response_format={"type": "json_object"},
		temperature=0.2,
		max_tokens=1500,
	)

	raw_content = response.choices[0].message.content or "{}"
	data = _clean_json_response(raw_content)

	# Validate and normalize model output against genuine input papers
	raw_items = data.get("papers") or []
	validated_items: list[PaperFeatureComparison] = []
	seen_ids: set[str] = set()

	# Map raw model items by ID or position
	model_items_by_id: dict[str, dict[str, Any]] = {}
	for idx, item in enumerate(raw_items):
		if isinstance(item, dict):
			mid = str(item.get("arxiv_id", "")).strip()
			if mid:
				model_items_by_id[mid] = item
			# Also key by 1-based index string if model returned "PAPER 1" or index
			model_items_by_id[str(idx + 1)] = item

	# Construct validated features ensuring 1-to-1 correspondence with input papers
	for idx, (aid, orig_rec) in enumerate(input_map.items(), start=1):
		m_item = model_items_by_id.get(aid) or model_items_by_id.get(str(idx)) or {}

		validated_items.append(
			PaperFeatureComparison(
				arxiv_id=aid,
				title=orig_rec["title"],
				entry_url=orig_rec["entry_url"],
				pdf_url=orig_rec["pdf_url"],
				authors=orig_rec["authors"],
				published=orig_rec["published"],
				research_question=_sanitize_text_field(m_item.get("research_question")),
				method=_sanitize_text_field(m_item.get("method")),
				datasets_or_setup=_sanitize_text_field(m_item.get("datasets_or_setup")),
				reported_findings=_sanitize_text_field(m_item.get("reported_findings")),
				limitations=_sanitize_text_field(
					m_item.get("limitations"),
					default="Not explicitly stated in abstract",
				),
			)
		)

	similarities = [str(s).strip() for s in (data.get("similarities") or []) if str(s).strip()]
	differences = [str(d).strip() for d in (data.get("differences") or []) if str(d).strip()]
	research_gaps = [str(g).strip() for g in (data.get("research_gaps") or []) if str(g).strip()]

	return ComparisonResult(
		papers=validated_items,
		similarities=similarities,
		differences=differences,
		research_gaps=research_gaps,
		disclaimer=(
			"Comparison generated from abstracts by Llama 3.1 8B Instant. "
			"Information not stated in abstracts is represented as 'Not explicitly reported'. "
			"Research gaps represent model-generated interpretations based on reported limitations."
		),
	)
