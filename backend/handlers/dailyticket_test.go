package handlers

import (
	"encoding/json"
	"testing"
)

func TestDailyTicketWrapperDecodesProgress(t *testing.T) {
	var response dailyTicketResponse
	if err := json.Unmarshal([]byte(`{"DailyRewards":{"RemainingLifetimeSeconds":13177,"BonusMilestonesPending":0,"Milestones":[{"Progress":4,"BonusApplied":true},{"Progress":3,"BonusApplied":false}]}}`), &response); err != nil {
		t.Fatal(err)
	}
	if got := response.DailyRewards.Milestones[0].Progress; got != 4 {
		t.Fatalf("first milestone progress = %d, want 4", got)
	}
	if !response.DailyRewards.Milestones[0].BonusApplied {
		t.Fatal("first milestone bonus was not preserved")
	}
}
