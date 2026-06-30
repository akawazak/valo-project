package handlers

import (
	"errors"
	"testing"
)

func TestExpectedNoPartyErrors(t *testing.T) {
	for _, message := range []string{
		`Riot API returned status 404: {"errorCode":"RESOURCE_NOT_FOUND"}`,
		`Riot API returned status 400: {"errorCode":"BAD_PARAMETER","message":"Bad parameter used as input"}`,
		"player not in party",
	} {
		if !isExpectedNoPartyError(errors.New(message)) {
			t.Fatalf("expected no-party error for %q", message)
		}
	}
	if isExpectedNoPartyError(errors.New(`Riot API returned status 400: {"errorCode":"BAD_REQUEST"}`)) {
		t.Fatal("unrelated 400 must remain an error")
	}
}
