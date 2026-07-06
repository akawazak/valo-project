package tick

import "testing"

func TestMatchEndRequiresSustainedInactivity(t *testing.T) {
	ticker := new(Ticker)
	for i := 0; i < inactiveChecksBeforeRestore-1; i++ {
		if ticker.recordMatchActivity(false) {
			t.Fatalf("restored early after %d checks", i+1)
		}
	}
	if !ticker.recordMatchActivity(false) {
		t.Fatal("expected restoration after sustained inactivity")
	}
}

func TestActiveMatchResetsTransientFailures(t *testing.T) {
	ticker := new(Ticker)
	for i := 0; i < inactiveChecksBeforeRestore-1; i++ {
		ticker.recordMatchActivity(false)
	}
	if ticker.recordMatchActivity(true) {
		t.Fatal("active match must not restore")
	}
	if ticker.inactiveChecks != 0 || ticker.recordMatchActivity(false) {
		t.Fatal("active match did not reset inactive checks")
	}
}
