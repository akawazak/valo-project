package riothttp

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const maxAttempts = 3

type APIError struct {
	StatusCode int
	RetryAfter time.Duration
	Body       string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("Riot API returned status %d: %s", e.StatusCode, e.Body)
}

// Do performs a Riot request with bounded retry handling for transient
// responses. Riot's Retry-After header wins; otherwise retries use 500ms/1s.
func Do(client *http.Client, req *http.Request) ([]byte, error) {
	for attempt := 0; attempt < maxAttempts; attempt++ {
		current := req
		if attempt > 0 {
			current = req.Clone(req.Context())
			if req.GetBody != nil {
				body, err := req.GetBody()
				if err != nil {
					return nil, fmt.Errorf("recreate request body: %w", err)
				}
				current.Body = body
			}
		}

		resp, err := client.Do(current)
		if err != nil {
			return nil, fmt.Errorf("request: %w", err)
		}
		out, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("read body: %w", readErr)
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return out, nil
		}
		if resp.StatusCode == http.StatusTooManyRequests || attempt == maxAttempts-1 || !retryable(resp.StatusCode) {
			retryAfter := time.Duration(0)
			if resp.StatusCode == http.StatusTooManyRequests {
				retryAfter = retryDelay(resp.Header.Get("Retry-After"), attempt)
				if strings.TrimSpace(resp.Header.Get("Retry-After")) == "" {
					retryAfter = 30 * time.Second
				}
			}
			return nil, &APIError{StatusCode: resp.StatusCode, RetryAfter: retryAfter, Body: truncate(out, 256)}
		}
		if err := wait(req.Context(), retryDelay(resp.Header.Get("Retry-After"), attempt)); err != nil {
			return nil, err
		}
	}
	panic("unreachable")
}

func retryable(status int) bool {
	return status == http.StatusTooManyRequests ||
		status == http.StatusBadGateway ||
		status == http.StatusServiceUnavailable ||
		status == http.StatusGatewayTimeout
}

func retryDelay(header string, attempt int) time.Duration {
	if seconds, err := strconv.Atoi(strings.TrimSpace(header)); err == nil && seconds >= 0 {
		return time.Duration(seconds) * time.Second
	}
	if when, err := http.ParseTime(header); err == nil {
		if delay := time.Until(when); delay > 0 {
			return delay
		}
		return 0
	}
	return time.Duration(attempt+1) * 500 * time.Millisecond
}

func wait(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func truncate(body []byte, limit int) string {
	if len(body) <= limit {
		return string(body)
	}
	return string(body[:limit]) + "..."
}
