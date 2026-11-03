"""FairMatch AI end-to-end demo: parse -> score -> allocate -> audit -> explain.

Run with: python demo.py   (set OPENAI_API_KEY for LLM parsing and narratives)
"""
import sys

from core.pipeline import run_pipeline
from sample_data.candidates import CANDIDATES
from sample_data.postings import POSTINGS


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    # Demo-only group labels: alternate group_a / group_b (not real attributes).
    group_of = {f"c{i}": ("group_a" if i % 2 else "group_b") for i in range(1, len(CANDIDATES) + 1)}
    res = run_pipeline(CANDIDATES, POSTINGS, group_of=group_of)
    cname = {c.id: c.name for c in res.candidates}
    ptitle = {p.id: p.title for p in res.postings}

    print("=" * 70)
    print("FAIRMATCH AI -- DEMO RUN")
    print("=" * 70)
    print("\n[1] Extracted skills\n")
    for c in res.candidates:
        print(f"  {c.id} {c.name:<15} exp={c.experience_years} edu={c.education_level} "
              f"{', '.join(c.skills)}")
    for p in res.postings:
        print(f"  {p.id} {p.title:<28} cap={p.capacity} requires: {', '.join(p.required_skills)}")

    print("\n[2] Score table\n")
    print("  " + f"{'Candidate':<15}" + "".join(f"{p.id:<8}" for p in res.postings))
    for c, row in zip(res.candidates, res.breakdowns):
        print("  " + f"{c.name:<15}" + "".join(f"{b.total:<8.3f}" for b in row))

    print("\n[3] Allocations side by side\n")
    for name, r in res.results.items():
        print(f"  {name}: total score={r.total_score:.3f} blocking pairs={r.blocking_pairs} "
              f"runtime={r.runtime_ms:.2f} ms")
        for a in r.allocation.assignments:
            print(f"     {cname[a.candidate_id]:<15} -> {ptitle[a.posting_id]:<28} ({a.score:.3f})")
        for cid in r.allocation.unallocated:
            print(f"     {cname[cid]:<15} -> (unallocated)")

    print("\n[4] Fairness report (group labels are DEMO-ONLY, assigned alternately)\n")
    for name, rep in (res.fairness or {}).items():
        print(f"  {name}: disparate impact={rep.disparate_impact_ratio:.2f} "
              f"four-fifths pass={rep.passes_four_fifths} parity diff={rep.parity_difference:.2f}")
        for g in rep.groups:
            print(f"     {g.group}: {g.selected}/{g.size} selected, mean score={g.mean_score:.3f}")

    print("\n[5] Explanations\n")
    for name, exps in res.explanations.items():
        print(f"  {name}:")
        for e in exps:
            print(f"   {cname[e.candidate_id]} -> {ptitle[e.posting_id]}")
            for reason in e.reasons:
                print(f"      - {reason}")
            print(f"      narrative: {e.narrative}")

    print("\n" + "=" * 70)
    print("DEMO COMPLETE")
    print("=" * 70)


if __name__ == "__main__":
    main()
