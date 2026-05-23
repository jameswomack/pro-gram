--------------------------- MODULE MC_EvalRunner ---------------------------
(***************************************************************************)
(* Bounded model-check wrapper for EvalRunner. Keep the case sets tiny —   *)
(* the state graph is exponential in case count. Two cases per tier covers *)
(* the interesting interleavings (tier ordering + sequencing + write).     *)
(***************************************************************************)

EXTENDS EvalRunner

CONSTANTS u1, u2, p1, p2, t1

MCUnitCases     == {u1, u2}
MCPropertyCases == {p1, p2}
MCTaskCases     == {t1}
MCRequestedTiers == {"unit","property","task"}

=============================================================================
