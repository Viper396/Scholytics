from __future__ import annotations

import json
import logging
import re
from typing import Any

from pydantic import BaseModel, Field

from services.summarizer import _get_client, _get_model_name, is_reasoning_model

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


def _call_groq_compare(
	client: Any,
	model_name: str,
	messages: list[dict[str, str]],
	temperature: float = 0.2,
) -> str:
	"""
	Execute the Groq chat completion for paper comparison with appropriate token budgets
	and reasoning parameters, with resilient fallback if JSON validation fails.
	"""
	kwargs: dict[str, Any] = {
		"model": model_name,
		"messages": messages,
		"temperature": temperature,
		"max_completion_tokens": 4096,
		"response_format": {"type": "json_object"},
	}

	if is_reasoning_model(model_name):
		kwargs["reasoning_format"] = "parsed"
		kwargs["reasoning_effort"] = "low"

	try:
		response = client.chat.completions.create(**kwargs)
		return response.choices[0].message.content or "{}"
	except TypeError as te:
		if "max_completion_tokens" in str(te):
			kwargs.pop("max_completion_tokens", None)
			kwargs["max_tokens"] = 4096
			response = client.chat.completions.create(**kwargs)
			return response.choices[0].message.content or "{}"
		raise
	except Exception as exc:
		exc_msg = str(exc).lower()
		logger.warning("Primary comparison call failed: %s", exc)

		# 1. Fallback for non-reasoning models if reasoning parameters caused error
		if "reasoning" in exc_msg or "unrecognized" in exc_msg or "unexpected parameter" in exc_msg:
			fallback_kwargs = dict(kwargs)
			fallback_kwargs.pop("reasoning_format", None)
			fallback_kwargs.pop("reasoning_effort", None)
			try:
				response = client.chat.completions.create(**fallback_kwargs)
				return response.choices[0].message.content or "{}"
			except Exception as sub_exc:
				exc = sub_exc
				exc_msg = str(sub_exc).lower()

		# 2. Fallback for Groq server-side JSON validation failure (json_validate_failed)
		if (
			"json_validate_failed" in exc_msg
			or "failed to validate json" in exc_msg
			or "failed to generate json" in exc_msg
		):
			logger.info("Retrying Groq comparison without strict json_object response_format...")
			retry_kwargs: dict[str, Any] = {
				"model": model_name,
				"messages": messages,
				"temperature": temperature,
				"max_completion_tokens": 4096,
			}
			if is_reasoning_model(model_name):
				retry_kwargs["reasoning_format"] = "parsed"
				retry_kwargs["reasoning_effort"] = "low"

			try:
				response = client.chat.completions.create(**retry_kwargs)
				return response.choices[0].message.content or "{}"
			except TypeError:
				retry_kwargs.pop("max_completion_tokens", None)
				retry_kwargs["max_tokens"] = 4096
				response = client.chat.completions.create(**retry_kwargs)
				return response.choices[0].message.content or "{}"
			except Exception as retry_exc:
				logger.error("Fallback comparison call also failed: %s", retry_exc)
				raise retry_exc from exc

		raise exc


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

	from services.cache import build_compare_cache_key, paper_comparison_cache  # noqa: PLC0415
	cache_key = build_compare_cache_key(papers, query) if len(papers) >= _MIN_COMPARE_PAPERS else ""
	if cache_key:
		cached = paper_comparison_cache.get(cache_key)
		if cached:
			return ComparisonResult.model_validate(cached)

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
		"3. Keep every text field concise (1-2 sentences) to stay well within completion limits.\n"
		"4. Clearly associate each paper's features with its exact ID provided in the prompt.\n"
		"5. Research Gaps must represent potential opportunities or unaddressed limitations derived directly from the stated evidence, framed as model interpretations.\n"
		"6. Output strictly a single JSON object with keys: 'papers', 'similarities', 'differences', 'research_gaps'. Do not wrap in markdown or add conversational text."
	)

	user_prompt = (
		f"Compare the following {len(eval_papers)} research papers"
		+ (f" in the context of query: \"{query.strip()}\"" if query and query.strip() else "")
		+ ":\n\n"
		f"{papers_context}\n\n"
		"Provide a concise JSON object adhering strictly to this structure:\n"
		"{\n"
		"  \"papers\": [\n"
		"    {\n"
		"      \"arxiv_id\": \"<exact ID>\",\n"
		"      \"research_question\": \"<primary research objective in 1-2 concise sentences>\",\n"
		"      \"method\": \"<proposed method or approach in 1-2 concise sentences>\",\n"
		"      \"datasets_or_setup\": \"<stated datasets or 'Not explicitly reported in abstract'>\",\n"
		"      \"reported_findings\": \"<key empirical/theoretical findings in 1-2 concise sentences>\",\n"
		"      \"limitations\": \"<limitations stated by authors, or 'Not explicitly stated in abstract'>\"\n"
		"    }\n"
		"  ],\n"
		"  \"similarities\": [\"<shared premise, common technique, or consensus point (1 sentence)>\"],\n"
		"  \"differences\": [\"<contrasting technique, differing experimental goal, or divergent finding (1 sentence)>\"],\n"
		"  \"research_gaps\": [\"<potential research gap or open direction derived from reported limitations (1 sentence)>\"]\n"
		"}"
	)

	raw_content = _call_groq_compare(
		client=client,
		model_name=model_name,
		messages=[
			{"role": "system", "content": system_prompt},
			{"role": "user", "content": user_prompt},
		],
		temperature=0.2,
	)
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

	result = ComparisonResult(
		papers=validated_items,
		similarities=similarities,
		differences=differences,
		research_gaps=research_gaps,
		disclaimer=(
			f"Comparison generated from abstracts by Groq ({_get_model_name()}). "
			"Information not stated in abstracts is represented as 'Not explicitly reported'. "
			"Research gaps represent model-generated interpretations based on reported limitations."
		),
	)
	if cache_key:
		paper_comparison_cache.set(cache_key, result.model_dump())
	return result
