package tracking

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// NewRiotFetcher builds a `fetchRiot` callback compatible with
// NewSyncManager. It takes the same headers used by
// backend/handlers/remote.go (built via buildRiotHeaders) and
// performs plain HTTP requests, returning the raw response body.
//
// We use a private copy of remote.go's runRiotJSON logic (rather
// than reaching into the handlers package) so the tracking package
// stays self-contained and unit-testable without a full app boot.
func NewRiotFetcher(headers http.Header) func(method, apiURL string, body []byte) ([]byte, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	return func(method, apiURL string, body []byte) ([]byte, error) {
		var reader io.Reader
		if len(body) > 0 {
			reader = bytes.NewReader(body)
		}
		req, err := http.NewRequest(method, apiURL, reader)
		if err != nil {
			return nil, fmt.Errorf("new request: %w", err)
		}
		for k, vals := range headers {
			for _, v := range vals {
				req.Header.Set(k, v)
			}
		}
		if len(body) > 0 && req.Header.Get("Content-Type") == "" {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("request: %w", err)
		}
		defer resp.Body.Close()
		out, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("read body: %w", err)
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("riot %s %s returned status %d: %s", method, apiURL, resp.StatusCode, truncateForLog(out, 256))
		}
		return out, nil
	}
}

// StaticFetchRiot is the test-only constructor used by db_test.go and
// sync_test.go. It bypasses the HTTP client and returns the canned
// response for any URL that has been registered via RegisterStatic.
func StaticFetchRiot() func(method, apiURL string, body []byte) ([]byte, error) {
	return func(method, apiURL string, body []byte) ([]byte, error) {
		entry, ok := staticResponses.lookup(method, apiURL)
		if !ok {
			return nil, fmt.Errorf("StaticFetchRiot: no registered response for %s %s", method, apiURL)
		}
		return entry, nil
	}
}

// staticResponseStore is a tiny URL -> body registry used by tests.
type staticResponseStore struct {
	byMethodURL map[string][]byte
}

var staticResponses = &staticResponseStore{byMethodURL: map[string][]byte{}}

// RegisterStatic registers a canned response for (method, apiURL).
func (s *staticResponseStore) register(method, apiURL string, body []byte) {
	s.byMethodURL[method+" "+apiURL] = body
}

func (s *staticResponseStore) lookup(method, apiURL string) ([]byte, bool) {
	v, ok := s.byMethodURL[method+" "+apiURL]
	return v, ok
}

// RegisterStaticResponse registers a canned response for tests.
// Safe to call from any goroutine (init only in practice).
func RegisterStaticResponse(method, apiURL string, body []byte) {
	staticResponses.register(method, apiURL, body)
}

// ClearStaticResponses wipes the registry. Tests should defer this
// so they don't leak state into the next test.
func ClearStaticResponses() {
	staticResponses.byMethodURL = map[string][]byte{}
}

// JSONBody is a small helper that marshals v to indented JSON for use
// in test fixtures / fixtures registered via RegisterStaticResponse.
func JSONBody(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

func truncateForLog(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "..."
}
