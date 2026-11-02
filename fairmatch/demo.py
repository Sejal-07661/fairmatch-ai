"""
FairMatch AI -- End-to-End Demo
--------------------------------
Run this script to see the full pipeline working on sample data:

    Parsing -> Embeddings -> Scoring -> Allocation -> Explanation

Run with: python3 demo.py
"""

from app.parser import parse_candidate, parse_posting
from app.embeddings import EmbeddingService
from app.scoring import compute_fit_score
from app.allocation import allocate
from sample_data.candidates import CANDIDATES
from sample_data.postings import POSTINGS


def main():
    print("=" * 70)
    print("FAIRMATCH AI -- DEMO RUN")
    print("=" * 70)

    # ---- Step 1: Parse candidates and postings ----
    print("\n[STEP 1] Parsing candidates and postings...\n")
    candidates = [parse_candidate(c["name"], c["resume_text"]) for c in CANDIDATES]
    postings = [parse_posting(p["title"], p["posting_text"], p["capacity"]) for p in POSTINGS]

    for c in candidates:
        print(f"  Candidate: {c['name']:<15} | Skills found: {c['skills']}")
    print()
    for p in postings:
        print(f"  Posting:   {p['title']:<28} | Required skills: {p['required_skills']}")

    # ---- Step 2: Fit the embedding service on all text ----
    print("\n[STEP 2] Building text embeddings (TF-IDF vectors)...")
    all_text = [c["raw_text"] for c in candidates] + [p["raw_text"] for p in postings]
    embedder = EmbeddingService()
    embedder.fit(all_text)
    print("  Embeddings ready.")

    # ---- Step 3: Score every candidate against every posting ----
    print("\n[STEP 3] Scoring every candidate-posting pair...\n")
    score_matrix = []
    all_scores = []
    for c in candidates:
        row = []
        for p in postings:
            result = compute_fit_score(c, p, embedder)
            row.append(result["final_score"])
            all_scores.append(result)
        score_matrix.append(row)

    # print a readable score table
    header = f"{'Candidate':<15}" + "".join(f"{p['title'][:18]:<20}" for p in postings)
    print("  " + header)
    for i, c in enumerate(candidates):
        row_str = f"{c['name']:<15}" + "".join(f"{score_matrix[i][j]:<20}" for j in range(len(postings)))
        print("  " + row_str)

    # ---- Step 4: Allocate candidates to postings under seat limits ----
    print("\n[STEP 4] Running allocation (Hungarian Algorithm)...\n")
    allocations = allocate(candidates, postings, score_matrix)

    for a in allocations:
        print(f"  -> {a['candidate']:<15} allocated to  {a['posting']:<28} (score: {a['score']})")

    # ---- Step 5: Explain each allocation ----
    print("\n[STEP 5] Explaining each match...\n")
    score_lookup = {(s["candidate"], s["posting"]): s for s in all_scores}
    for a in allocations:
        detail = score_lookup[(a["candidate"], a["posting"])]
        print(f"  {a['candidate']} -> {a['posting']}")
        print(f"     Matched skills: {detail['matched_skills'] if detail['matched_skills'] else 'None (matched mainly on overall text similarity)'}")
        print(f"     Skill overlap score: {detail['skill_overlap']}  |  Text similarity score: {detail['text_similarity']}")
        print(f"     Final combined score: {detail['final_score']}\n")

    print("=" * 70)
    print("DEMO COMPLETE")
    print("=" * 70)


if __name__ == "__main__":
    main()
