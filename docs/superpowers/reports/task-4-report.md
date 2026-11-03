# Task 4 report

Implemented core/parser.py and tests/test_parser.py. 11 tests pass, ruff clean.
LLM fallback catches Exception; word-boundary PhraseMatcher; ValueError on bad suffix; lazy fitz/docx imports.
Concern: pymupdf/python-docx not added to requirements.txt (forbidden); PDF/DOCX paths untested.

## Fix note (judge wave 2)
Education regexes now word-bounded (B.E needs dot); text normalised with " ".join(text.split()) so multi-word skills match across wraps; LLM profile validated (bad types fall back, years>=0, edu clamped 0..4). 31 tests pass, ruff clean.
Round 2: dotless B Tech / M Tech / upper-case BE now match (judge regexes); tests extended.
