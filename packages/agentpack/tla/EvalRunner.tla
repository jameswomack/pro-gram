---------------------------- MODULE EvalRunner ----------------------------
(***************************************************************************)
(* Formal model of the agentpack eval runner state machine                 *)
(* (src/eval/runner.ts) and its on-disk artifact contract                  *)
(* (src/eval/storage.ts).                                                  *)
(*                                                                         *)
(* What this spec pins down — i.e. what Phase 4 (differential evals,       *)
(* trajectory diffing, model-swap divergence) is allowed to assume:        *)
(*                                                                         *)
(*  1. Per-case progress is monotonic: a case only moves                   *)
(*     queued -> running -> {scored, errored}. It never goes back.         *)
(*                                                                         *)
(*  2. Tiers run sequentially in the fixed order unit, property, task.     *)
(*     No case in tier i+1 may start until every requested case in         *)
(*     tier i has terminated. EvalRunner.run() in runner.ts enforces       *)
(*     this with three sequential blocks.                                  *)
(*                                                                         *)
(*  3. The runner is single-threaded: at most one case is `running` at     *)
(*     any moment. The implementation `await`s each case before the next.  *)
(*                                                                         *)
(*  4. The run artifact is atomic and complete: the JSONL file is only     *)
(*     written once every requested case has terminated, and the file      *)
(*     then contains exactly one record per terminated case (plus the      *)
(*     header). writeRun() in storage.ts is a single writeFile() call —    *)
(*     no partial flushes exist for replayers to trip on.                  *)
(*                                                                         *)
(*  5. Every queued case eventually terminates (under weak fairness on     *)
(*     the case-scoring actions) and the run file is eventually written.   *)
(*     This is the precondition for any future differential-eval or       *)
(*     trajectory-diff feature: an artifact is either absent or complete.  *)
(*                                                                         *)
(* This model abstracts away trajectory contents, judge details, MCP      *)
(* tool calls, and timing. It is a coordination model, not a              *)
(* computation model.                                                     *)
(***************************************************************************)

EXTENDS Naturals, FiniteSets, Sequences, TLC

CONSTANTS
    UnitCases,       \* set of case IDs in cases.yaml
    PropertyCases,   \* set of case IDs in properties.yaml
    TaskCases,       \* set of case IDs in tasks.yaml
    RequestedTiers   \* subset of {"unit","property","task"}; the --tier flag

ASSUME
    /\ UnitCases \cap PropertyCases = {}
    /\ UnitCases \cap TaskCases     = {}
    /\ PropertyCases \cap TaskCases = {}
    /\ RequestedTiers \subseteq {"unit","property","task"}

Tier(c) ==
    IF c \in UnitCases     THEN "unit"
    ELSE IF c \in PropertyCases THEN "property"
    ELSE "task"

AllCases == UnitCases \cup PropertyCases \cup TaskCases
TierOrder == <<"unit","property","task">>
TierIndex(t) ==
    CHOOSE i \in 1..Len(TierOrder) : TierOrder[i] = t

CasesInTier(t) ==
    CASE t = "unit"     -> UnitCases
      [] t = "property" -> PropertyCases
      [] t = "task"     -> TaskCases

\* A case is "active" iff its tier was requested. Non-requested cases stay
\* "skipped" forever and are not represented in the run artifact.
ActiveCases == { c \in AllCases : Tier(c) \in RequestedTiers }
SkippedCases == AllCases \ ActiveCases

TerminalStatuses == {"scored","errored"}
TerminatedCases(status) == { c \in AllCases : status[c] \in TerminalStatuses }

VARIABLES
    caseStatus,   \* [AllCases -> {"queued","running","scored","errored","skipped"}]
    writeState    \* "pending" | "written"

vars == <<caseStatus, writeState>>

TypeOK ==
    /\ caseStatus \in [AllCases ->
           {"queued","running","scored","errored","skipped"}]
    /\ writeState \in {"pending","written"}

Init ==
    /\ caseStatus = [c \in AllCases |->
           IF c \in ActiveCases THEN "queued" ELSE "skipped"]
    /\ writeState = "pending"

\* An earlier tier is "done" when every active case in it has terminated.
EarlierTiersDone(c) ==
    \A t \in {"unit","property","task"} :
        (TierIndex(t) < TierIndex(Tier(c)) /\ t \in RequestedTiers)
            => \A c2 \in CasesInTier(t) : caseStatus[c2] \in TerminalStatuses

NoCaseRunning ==
    \A c \in AllCases : caseStatus[c] # "running"

StartCase(c) ==
    /\ c \in ActiveCases
    /\ caseStatus[c] = "queued"
    /\ EarlierTiersDone(c)
    /\ NoCaseRunning
    /\ caseStatus' = [caseStatus EXCEPT ![c] = "running"]
    /\ UNCHANGED writeState

ScoreCase(c) ==
    /\ caseStatus[c] = "running"
    /\ caseStatus' = [caseStatus EXCEPT ![c] = "scored"]
    /\ UNCHANGED writeState

ErrorCase(c) ==
    /\ caseStatus[c] = "running"
    /\ caseStatus' = [caseStatus EXCEPT ![c] = "errored"]
    /\ UNCHANGED writeState

\* writeRun() is the final step in EvalRunner.run() callers (apps/cli) — fires
\* exactly once after every active case is terminal.
WriteRun ==
    /\ writeState = "pending"
    /\ \A c \in ActiveCases : caseStatus[c] \in TerminalStatuses
    /\ writeState' = "written"
    /\ UNCHANGED caseStatus

Next ==
    \/ \E c \in AllCases : StartCase(c)
    \/ \E c \in AllCases : ScoreCase(c)
    \/ \E c \in AllCases : ErrorCase(c)
    \/ WriteRun

\* Fairness: every running case eventually terminates, and the write fires
\* once it's enabled. Without these, TLC trivially "satisfies" liveness by
\* stuttering. WF on StartCase ensures we don't idle with queued work.
Fairness ==
    /\ \A c \in AllCases : WF_vars(StartCase(c))
    /\ \A c \in AllCases : WF_vars(ScoreCase(c) \/ ErrorCase(c))
    /\ WF_vars(WriteRun)

Spec == Init /\ [][Next]_vars /\ Fairness

(***************************************************************************)
(* Safety invariants                                                       *)
(***************************************************************************)

\* At most one case is in flight. The runner is sequential.
AtMostOneRunning ==
    Cardinality({ c \in AllCases : caseStatus[c] = "running" }) <= 1

\* A skipped case never enters the workflow.
SkippedStaysSkipped ==
    \A c \in SkippedCases : caseStatus[c] = "skipped"

\* Tier ordering: a tier-N case can only be in {running, scored, errored}
\* if every active tier-<N case has terminated.
TierOrdering ==
    \A c \in AllCases :
        caseStatus[c] \in {"running","scored","errored"}
            => EarlierTiersDone(c)

\* The artifact contract: writing only happens after all active work is
\* terminal, and a written file implies a record exists for every active case.
WriteRequiresCompletion ==
    writeState = "written"
        => \A c \in ActiveCases : caseStatus[c] \in TerminalStatuses

\* Combined safety bundle for the .cfg.
SafetyOK ==
    /\ TypeOK
    /\ AtMostOneRunning
    /\ SkippedStaysSkipped
    /\ TierOrdering
    /\ WriteRequiresCompletion

(***************************************************************************)
(* Liveness                                                                *)
(***************************************************************************)

\* Every queued case is eventually terminal — no case gets stuck.
EventualTermination ==
    \A c \in ActiveCases : <>(caseStatus[c] \in TerminalStatuses)

\* The artifact is eventually written. Phase 4 differential evals rely on
\* "artifact is absent OR complete" — this is the "OR complete" side.
EventualWrite == <>(writeState = "written")

LivenessOK ==
    /\ EventualTermination
    /\ EventualWrite

=============================================================================
