package protocoltest

import "testing"

// TestJudgeCase pins the registry semantics both entry points share: an
// unregistered case reports its failures, a registered failing case is a
// known gap, and a registered case that passes is itself a failure.
func TestJudgeCase(t *testing.T) {
	t.Parallel()

	const key = "TestJudgeCase/registered"
	registry := map[string]KnownGap{key: {ID: "X0", Reason: "judgeCase fixture"}}

	if errs, gap := judgeCaseIn(registry, "TestJudgeCase/unregistered", []string{"boom"}); gap != nil || len(errs) != 1 {
		t.Errorf("unregistered failing case: errs=%v gap=%v, want the failure and no gap", errs, gap)
	}
	if errs, gap := judgeCaseIn(registry, "TestJudgeCase/unregistered", nil); gap != nil || len(errs) != 0 {
		t.Errorf("unregistered passing case: errs=%v gap=%v, want neither", errs, gap)
	}
	if errs, gap := judgeCaseIn(registry, key, []string{"boom"}); gap == nil || gap.ID != "X0" || len(errs) != 0 {
		t.Errorf("registered failing case: errs=%v gap=%v, want gap X0 and no errors", errs, gap)
	}
	if errs, gap := judgeCaseIn(registry, key, nil); gap != nil || len(errs) != 1 {
		t.Errorf("registered passing case: errs=%v gap=%v, want a gap-is-fixed error", errs, gap)
	}
}
