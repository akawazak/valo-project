package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReturnErrorPreservesRiotEntitlementFailure(t *testing.T) {
	h := NewHandler(nil)
	response := httptest.NewRecorder()
	h.returnError(response, errors.New(`Is VALORANT running? error occurred while running local request: {
		"httpStatus": 403,
		"errorCode": "MISSING_ENTITLEMENT",
		"message": "Required entitlement not present on user request"
	}`))

	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["errorCode"] != "MISSING_ENTITLEMENT" {
		t.Fatalf("errorCode = %v", body["errorCode"])
	}
	if body["message"] != "Required entitlement not present on user request" {
		t.Fatalf("message = %v", body["message"])
	}
}

func TestReturnErrorDoesNotExposeGenericInternalError(t *testing.T) {
	h := NewHandler(nil)
	response := httptest.NewRecorder()
	h.returnError(response, errors.New("database password=secret"))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["errorCode"] != "VV-BACKEND" || body["message"] == "database password=secret" {
		t.Fatalf("unexpected response body: %v", body)
	}
}

func TestReturnErrorMapsMissingAuthentication(t *testing.T) {
	h := NewHandler(nil)
	response := httptest.NewRecorder()
	h.returnError(response, errors.New("authentication required: please log in first"))

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["errorCode"] != "AUTH_REQUIRED" {
		t.Fatalf("errorCode = %v", body["errorCode"])
	}
}

func TestReturnErrorMapsCompactBadClaimsResponse(t *testing.T) {
	h := NewHandler(nil)
	response := httptest.NewRecorder()
	h.returnError(response, errors.New(`Is VALORANT running? error occurred while running local request: {"error":"BAD_CLAIMS"}`))

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["errorCode"] != "BAD_CLAIMS" {
		t.Fatalf("errorCode = %v", body["errorCode"])
	}
}

func TestSafeBackendErrorRedactsCredentials(t *testing.T) {
	message := safeBackendError(errors.New("Bearer eyJ.access.token ssid=session-secret clid=client-secret"))
	if strings.Contains(message, "eyJ") || strings.Contains(message, "session-secret") || strings.Contains(message, "client-secret") {
		t.Fatalf("credentials were not redacted: %s", message)
	}
}
