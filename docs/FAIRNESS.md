# Fairness audit

Back to the [README](../README.md). Where it fits: [ARCHITECTURE.md](ARCHITECTURE.md).

The audit (`fairmatch/core/fairness.py`, function `audit`) looks only at the outcome of an allocation. It takes the allocation and a mapping from candidate to group label and reports, per algorithm:

| Metric | Definition |
|---|---|
| Group size, selected | Candidates carrying the label; how many of them received a seat |
| Selection rate | `selected / size` per group |
| Mean score | Average fit score of the selected candidates in the group (0 if none) |
| Disparate impact ratio | Lowest group selection rate divided by the highest, computed with exact fractions. It is 1.0 when there are fewer than two groups or nobody was selected |
| Four-fifths rule | `passes_four_fifths` is true when the ratio is at least 0.8 |
| Parity difference | Highest minus lowest selection rate |

A candidate who is allocated or unallocated but has no label raises an error in the audit. In a run (`api/services/runs.py`), if any candidate has no label the fairness section is skipped and the run records `fairness_skipped` instead.

## Example

Groups A and B have 4 candidates each; 2 of A and 1 of B get seats. Selection rates are 0.50 and 0.25, so the ratio is 0.5 (fails four-fifths) and the parity difference is 0.25.

## What it does and does not show

- It shows whether groups were selected at different rates in this run. The four-fifths rule is a screening heuristic from US employment guidance, not a legal or statistical test.
- It does not prove or rule out discrimination. With small groups, rates are noisy: one seat changes a rate a lot, and no significance test is applied.
- Group labels are never used for scoring, allocation or explanations (see the privacy rule in [ARCHITECTURE.md](ARCHITECTURE.md#privacy-rule)), so the audit measures outcomes of an attribute-blind method, not fairness of the inputs. Resume text can still correlate with a protected attribute, and the audit is the way to notice that.
- Only one label per candidate is supported, and metrics are not computed for intersections of attributes.
- Selection rate depends on seat availability: if there are fewer seats than candidates, someone is unselected whatever the algorithm does. Compare the two algorithms' reports to see how the algorithm choice changes rates.
- The Hungarian algorithm maximises total score and can differ from Gale-Shapley in who is selected, so the audit is reported separately for each algorithm in a run.

## Demo data

`fairmatch/demo.py` assigns the labels `group_a` and `group_b` alternately to its 6 sample candidates. They are demo-only and are not real attributes. In the dashboard an admin sets a group label per candidate (`PUT /candidates/{id}/demographics`) before starting a run. The sample resumes and postings are in `fairmatch/sample_data/`.
