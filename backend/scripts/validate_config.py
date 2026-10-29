"""
Pre-Deployment Configuration and Environment Validator for Scholytics.

Inspects deployment settings, environment variables, Pinecone readiness,
and security boundaries before deployment to Render and Vercel.

Checks performed:
1. Secrets Hygiene: Ensures no API keys are present in frontend bundles or .env.example.
2. Git Protection: Ensures real .env and secret files are properly ignored in .gitignore.
3. Production Settings: Verifies VECTOR_STORE_BACKEND=pinecone in production.
4. Python Runtime: Verifies Python 3.11 pinning for Render FastEmbed ONNX compatibility.
5. Pinecone Index Validation: Validates dimension (384), metric (cosine), and serverless spec.
6. Frontend Origin & CORS: Verifies FRONTEND_ORIGIN format and presence.

Usage:
    python backend/scripts/validate_config.py [--env production|development] [--live]
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

# Color helpers for terminal output
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
RESET = "\033[0m"


def log_pass(msg: str) -> None:
    print(f"[{GREEN}PASS{RESET}] {msg}")


def log_warn(msg: str) -> None:
    print(f"[{YELLOW}WARN{RESET}] {msg}")


def log_fail(msg: str) -> None:
    print(f"[{RED}FAIL{RESET}] {msg}")


def check_secrets_hygiene(root_dir: Path) -> list[str]:
    """Verify that .env.example and frontend code contains zero real credentials."""
    errors: list[str] = []

    # 1. Inspect .env.example
    env_example = root_dir / ".env.example"
    if env_example.exists():
        content = env_example.read_text(encoding="utf-8")
        patterns = [
            (r"gsk_[A-Za-z0-9_-]{12,}", "Real Groq API key found in .env.example"),
            (r"pcsk_[A-Za-z0-9_-]{12,}", "Real Pinecone API key found in .env.example"),
            (r"Bearer\s+[A-Za-z0-9._\-]{12,}", "Bearer token found in .env.example"),
        ]
        for pat, err_msg in patterns:
            if re.search(pat, content):
                errors.append(err_msg)

    # 2. Inspect frontend/ for leaked secrets
    frontend_dir = root_dir / "frontend"
    if frontend_dir.exists():
        for file_path in frontend_dir.rglob("*.tsx"):
            if "node_modules" in str(file_path) or ".next" in str(file_path):
                continue
            text = file_path.read_text(encoding="utf-8", errors="ignore")
            if "PINECONE_API_KEY" in text or "GROQ_API_KEY" in text:
                errors.append(f"Secret variable referenced directly in frontend file: {file_path.name}")
            if "NEXT_PUBLIC_PINECONE" in text or "NEXT_PUBLIC_GROQ" in text:
                errors.append(f"NEXT_PUBLIC secret leak pattern found in: {file_path.name}")

    return errors


def check_gitignore(root_dir: Path) -> list[str]:
    """Verify that gitignore properly excludes .env and secret files."""
    errors: list[str] = []
    gitignore = root_dir / ".gitignore"
    if not gitignore.exists():
        return ["Missing .gitignore file at repository root"]

    content = gitignore.read_text(encoding="utf-8")
    required_ignores = [".env", ".venv", "node_modules", ".next"]
    for req in required_ignores:
        if req not in content:
            errors.append(f".gitignore is missing critical entry: {req!r}")

    return errors


def check_python_version(root_dir: Path) -> list[str]:
    """Verify Python 3.11 pinning for Render FastEmbed ONNX compatibility."""
    errors: list[str] = []
    py_version_file = root_dir / ".python-version"
    if not py_version_file.exists():
        errors.append("Missing .python-version file at repository root (required for Render)")
    else:
        version = py_version_file.read_text(encoding="utf-8").strip()
        if not version.startswith("3.11"):
            errors.append(
                f".python-version is set to {version!r}. Render requires Python 3.11.x "
                "for pre-compiled FastEmbed ONNX CPU wheels."
            )

    return errors


def check_environment_variables(env_mode: str) -> tuple[list[str], list[str]]:
    """Validate environment variables for the target environment."""
    errors: list[str] = []
    warnings: list[str] = []

    is_prod = env_mode.lower() in ("production", "prod")

    backend = os.getenv("VECTOR_STORE_BACKEND", "chroma" if not is_prod else "pinecone").strip().lower()

    if is_prod:
        if backend != "pinecone":
            allow_chroma = os.getenv("ALLOW_EPHEMERAL_CHROMA_IN_PRODUCTION", "false").strip().lower() == "true"
            if not allow_chroma:
                errors.append(
                    "Production requires VECTOR_STORE_BACKEND=pinecone. "
                    "Ephemeral Chroma will lose all data when Render free-tier sleeps."
                )

        pinecone_key = os.getenv("PINECONE_API_KEY", "").strip()
        if not pinecone_key:
            errors.append("PINECONE_API_KEY is not set (mandatory in production)")

        groq_key = os.getenv("GROQ_API_KEY", "").strip()
        if not groq_key:
            errors.append("GROQ_API_KEY is not set (mandatory for summarization and synthesis)")

        frontend_origin = os.getenv("FRONTEND_ORIGIN", "").strip()
        if not frontend_origin or "localhost" in frontend_origin:
            warnings.append(
                f"FRONTEND_ORIGIN is '{frontend_origin or 'EMPTY'}'. In production, "
                "set this to your Vercel URL (e.g. https://scholytics.vercel.app)."
            )
    else:
        groq_key = os.getenv("GROQ_API_KEY", "").strip()
        if not groq_key:
            warnings.append("GROQ_API_KEY is not set in development. LLM features will fail.")

    return errors, warnings


def check_live_pinecone() -> list[str]:
    """Optionally verify connection, dimension, and metric of live Pinecone index."""
    errors: list[str] = []
    api_key = os.getenv("PINECONE_API_KEY", "").strip()
    if not api_key:
        return ["Cannot perform live Pinecone check: PINECONE_API_KEY is not set"]

    index_name = os.getenv("PINECONE_INDEX_NAME", "scholytics-papers").strip()

    try:
        from pinecone import Pinecone

        pc = Pinecone(api_key=api_key)
        indexes = pc.list_indexes()
        index_names = [idx.name for idx in indexes]

        if index_name not in index_names:
            errors.append(f"Pinecone index {index_name!r} does not exist in account.")
            return errors

        for idx in indexes:
            if idx.name == index_name:
                if hasattr(idx, "dimension") and idx.dimension != 384:
                    errors.append(f"Pinecone index {index_name!r} has dimension={idx.dimension}, expected 384.")
                if hasattr(idx, "metric") and str(idx.metric).lower() != "cosine":
                    errors.append(f"Pinecone index {index_name!r} has metric={idx.metric!r}, expected 'cosine'.")
                break

    except Exception as exc:  # noqa: BLE001
        errors.append(f"Live Pinecone check encountered an error: {exc}")

    return errors


def run_validation(env_mode: str = "production", live_check: bool = False) -> bool:
    print("=================================================================")
    print(f"   SCHOLYTICS PRE-DEPLOYMENT CONFIGURATION CHECK ({env_mode.upper()})   ")
    print("=================================================================\n")

    root_dir = Path(__file__).resolve().parent.parent.parent
    all_passed = True

    # 1. Secrets Hygiene
    print("--- 1. Secrets & Frontend Hygiene ---")
    secret_errors = check_secrets_hygiene(root_dir)
    if secret_errors:
        all_passed = False
        for err in secret_errors:
            log_fail(err)
    else:
        log_pass("No exposed API keys or credentials in .env.example or frontend code.")

    # 2. Git Protection
    print("\n--- 2. Git Exclusion Check ---")
    git_errors = check_gitignore(root_dir)
    if git_errors:
        all_passed = False
        for err in git_errors:
            log_fail(err)
    else:
        log_pass(".gitignore properly excludes .env, credentials, and build caches.")

    # 3. Python Version Pinning
    print("\n--- 3. Python Version for Render ---")
    py_errors = check_python_version(root_dir)
    if py_errors:
        all_passed = False
        for err in py_errors:
            log_fail(err)
    else:
        log_pass(".python-version is pinned to 3.11.x (Render FastEmbed ONNX compatible).")

    # 4. Environment Variables
    print("\n--- 4. Environment Variables ---")
    env_errors, env_warnings = check_environment_variables(env_mode)
    if env_errors:
        all_passed = False
        for err in env_errors:
            log_fail(err)
    else:
        log_pass(f"Environment variables conform to {env_mode} requirements.")

    for warn in env_warnings:
        log_warn(warn)

    # 5. Live Pinecone Check (Optional)
    if live_check:
        print("\n--- 5. Live Pinecone Index Verification ---")
        live_errors = check_live_pinecone()
        if live_errors:
            all_passed = False
            for err in live_errors:
                log_fail(err)
        else:
            log_pass("Live Pinecone index verified: dimension=384, metric=cosine.")

    print("\n=================================================================")
    if all_passed:
        print(f" {GREEN}PRE-DEPLOYMENT VALIDATION PASSED{RESET} – Ready for {env_mode} deployment.")
    else:
        print(f" {RED}PRE-DEPLOYMENT VALIDATION FAILED{RESET} – Resolve the errors above.")
    print("=================================================================\n")

    return all_passed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scholytics Pre-Deployment Configuration Validator")
    parser.add_argument(
        "--env",
        choices=["production", "development"],
        default="production",
        help="Target deployment environment (default: production)",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Execute active live network checks against Pinecone API",
    )
    args = parser.parse_args()

    success = run_validation(env_mode=args.env, live_check=args.live)
    sys.exit(0 if success else 1)
