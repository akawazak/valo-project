package handlers

import (
	"backend/riothttp"
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/truearken/valclient/valclient"
)

const clientPlatform = "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9"
const riotClientAuthURL = "https://auth.riotgames.com/authorize"
const riotClientReauthURL = "https://auth.riotgames.com/api/v1/authorization"
const riotClientReauthUserAgent = "RiotGamesApi/24.3.0.3124 rso-auth (Windows;10;;Home, x64) riot_client/0"
const oauthAttemptLifetime = 10 * time.Minute

var errRiotLoginRequired = errors.New("Riot login required")

type oauthAttempt struct {
	Nonce     string
	ExpiresAt time.Time
}

// Current Riot client version (as of 2026-06-30). Hard-coded fallback in
// case the valorant-api.com version endpoint is unreachable. Stale version
// strings cause Riot APIs to reject requests with HTTP 400 BAD_PARAMETER,
// so this fallback is updated regularly and the endpoint is retried on a
// 30-minute TTL below.
const fallbackRiotClientVersion = "release-13.00-shipping-32-4990475"

var (
	versionMu      sync.RWMutex
	versionCached  = fallbackRiotClientVersion
	versionFetched time.Time
)

type remoteAuthHeaders struct {
	AccessToken       string
	EntitlementsToken string
	Puuid             string
	Region            string
}

func (h *Handler) SetLocalClient(val *valclient.ValClient) {
	if val != nil {
		val.Header.Set("X-Riot-ClientVersion", getRiotClientVersion())
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.Val != nil && h.Val != val {
		h.Val.Close()
	}
	h.Val = val
}

// getRiotClientVersion returns the X-Riot-ClientVersion header value. It
// fetches the current version from valorant-api.com (no key required) and
// caches it for 30 minutes. The previous implementation cached once per
// process via sync.Once: if the very first fetch failed (network blip at
// startup, etc.) every subsequent request used a hard-coded 2024 fallback
// until backend restart, and Riot APIs returned HTTP 400 BAD_PARAMETER
// because the version was too old.
func getRiotClientVersion() string {
	versionMu.RLock()
	if !versionFetched.IsZero() && time.Since(versionFetched) < 30*time.Minute {
		v := versionCached
		versionMu.RUnlock()
		return v
	}
	versionMu.RUnlock()

	if v := readLocalRiotClientVersion(); v != "" {
		versionMu.Lock()
		versionCached = v
		versionFetched = time.Now()
		versionMu.Unlock()
		return v
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get("https://valorant-api.com/v1/version")
	if err != nil {
		slog.Warn("riot client version fetch failed; using fallback",
			"err", err, "fallback", fallbackRiotClientVersion)
		versionMu.Lock()
		// Don't extend the cached timestamp — let the next call retry soon.
		versionMu.Unlock()
		return fallbackRiotClientVersion
	}
	defer resp.Body.Close()

	var result struct {
		Data struct {
			RiotClientVersion string `json:"riotClientVersion"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil ||
		strings.TrimSpace(result.Data.RiotClientVersion) == "" {
		slog.Warn("riot client version decode failed; using fallback",
			"err", err, "fallback", fallbackRiotClientVersion)
		return fallbackRiotClientVersion
	}

	versionMu.Lock()
	versionCached = result.Data.RiotClientVersion
	versionFetched = time.Now()
	versionMu.Unlock()
	return versionCached
}

func readLocalRiotClientVersion() string {
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(localAppData, "VALORANT", "Saved", "Logs", "ShooterGame.log"))
	if err != nil {
		return ""
	}
	return parseLocalRiotClientVersion(data)
}

func parseLocalRiotClientVersion(data []byte) string {
	matches := regexp.MustCompile(`CI server version:\s+(release-\S+)`).FindAllSubmatch(data, -1)
	if len(matches) == 0 {
		return ""
	}
	return strings.TrimSpace(string(matches[len(matches)-1][1]))
}

func (h *Handler) getClient(r *http.Request) (*valclient.ValClient, error) {
	remoteAuth, hasRemoteAuth, err := getRemoteAuthHeaders(r)
	if err != nil {
		return nil, err
	}

	if hasRemoteAuth {
		shard := getShardFromRegion(remoteAuth.Region)
		region := strings.ToLower(remoteAuth.Region)
		if region == "" {
			region = shard
		}
		return &valclient.ValClient{
			Shard:  valclient.Shard(shard),
			Region: valclient.Region(region),
			Player: &valclient.ValClientPlayer{Uuid: remoteAuth.Puuid},
			Header: buildRiotHeaders(remoteAuth.AccessToken, remoteAuth.EntitlementsToken),
		}, nil
	}

	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.Val != nil {
		return h.Val, nil
	}
	return nil, fmt.Errorf("authentication required: please log in first")
}

func getRemoteAuthHeaders(r *http.Request) (*remoteAuthHeaders, bool, error) {
	accessToken := r.Header.Get("X-Riot-Access-Token")
	entitlementsToken := r.Header.Get("X-Riot-Entitlements-JWT")
	puuid := r.Header.Get("X-Riot-Puuid")
	region := r.Header.Get("X-Riot-Region")

	hasAny := accessToken != "" || entitlementsToken != "" || puuid != "" || region != ""
	hasAll := accessToken != "" && entitlementsToken != "" && puuid != "" && region != ""
	if hasAny && !hasAll {
		return nil, false, fmt.Errorf("remote authentication is incomplete; please reconnect your Riot account")
	}
	if !hasAll {
		return nil, false, nil
	}
	if subject := accessTokenSubject(accessToken); subject != "" && !strings.EqualFold(subject, puuid) {
		return nil, false, fmt.Errorf("the refreshed Riot token belongs to a different account; refresh the selected account again")
	}
	return &remoteAuthHeaders{
		AccessToken:       accessToken,
		EntitlementsToken: entitlementsToken,
		Puuid:             puuid,
		Region:            region,
	}, true, nil
}

func selectedAccountPuuid(r *http.Request) string {
	return strings.ToLower(strings.TrimSpace(r.Header.Get("X-Riot-Selected-Puuid")))
}

func accessTokenSubject(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims struct {
		Subject string `json:"sub"`
	}
	if json.Unmarshal(payload, &claims) != nil {
		return ""
	}
	return strings.TrimSpace(claims.Subject)
}

func buildRiotHeaders(accessToken, entitlementsToken string) http.Header {
	header := make(http.Header)
	header.Set("Authorization", "Bearer "+accessToken)
	header.Set("X-Riot-Entitlements-JWT", entitlementsToken)
	header.Set("X-Riot-ClientPlatform", clientPlatform)
	header.Set("X-Riot-ClientVersion", getRiotClientVersion())
	header.Set("Content-Type", "application/json")
	return header
}

func getShardFromRegion(region string) string {
	switch strings.ToLower(region) {
	case "na", "latam", "br":
		return "na"
	case "eu":
		return "eu"
	case "ap":
		return "ap"
	case "kr":
		return "kr"
	default:
		return "na"
	}
}

func postJSON(apiURL, accessToken string, payload []byte, result any) error {
	req, err := http.NewRequest(http.MethodPost, apiURL, bytes.NewBuffer(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	bodyBytes, err := riothttp.Do(client, req)
	if err != nil {
		return err
	}
	return json.Unmarshal(bodyBytes, result)
}

func getJSON(apiURL, accessToken string, result any) error {
	req, err := http.NewRequest(http.MethodGet, apiURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	client := &http.Client{Timeout: 10 * time.Second}
	bodyBytes, err := riothttp.Do(client, req)
	if err != nil {
		return err
	}
	return json.Unmarshal(bodyBytes, result)
}

func putJSON(apiURL, accessToken string, payload []byte, result any) error {
	req, err := http.NewRequest(http.MethodPut, apiURL, bytes.NewBuffer(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	bodyBytes, err := riothttp.Do(client, req)
	if err != nil {
		return err
	}
	return json.Unmarshal(bodyBytes, result)
}

type AuthTokenRequest struct {
	URL string `json:"url"`
}

type AuthTokenResponse struct {
	AccessToken       string `json:"access_token"`
	EntitlementsToken string `json:"entitlements_token"`
	ExpiresIn         int    `json:"expires_in"`
	Puuid             string `json:"puuid"`
	Region            string `json:"region"`
	GameName          string `json:"game_name"`
	TagLine           string `json:"tag_line"`
	Cookies           string `json:"cookies,omitempty"`
}

type extractedTokens struct {
	AccessToken  string
	IDToken      string
	RefreshToken string
	State        string
	ExpiresIn    int
}

func extractTokens(redirectURL string) (string, string, int, error) {
	t, err := extractAllTokens(redirectURL)
	if err != nil {
		return "", "", 0, err
	}
	return t.AccessToken, t.IDToken, t.ExpiresIn, nil
}

func extractAllTokens(redirectURL string) (*extractedTokens, error) {
	var fragment string
	if idx := strings.Index(redirectURL, "#"); idx != -1 {
		fragment = redirectURL[idx+1:]
	} else if idx := strings.Index(redirectURL, "?"); idx != -1 {
		fragment = redirectURL[idx+1:]
	} else {
		fragment = redirectURL
	}
	values, err := url.ParseQuery(fragment)
	if err != nil {
		return nil, err
	}
	accessToken := values.Get("access_token")
	if accessToken == "" {
		return nil, fmt.Errorf("no access token found in redirect URL")
	}
	expiresIn := 3600
	if rawExpiresIn := values.Get("expires_in"); rawExpiresIn != "" {
		if parsed, err := strconv.Atoi(rawExpiresIn); err == nil && parsed > 0 {
			expiresIn = parsed
		}
	}
	return &extractedTokens{
		AccessToken:  accessToken,
		IDToken:      values.Get("id_token"),
		RefreshToken: values.Get("refresh_token"),
		State:        values.Get("state"),
		ExpiresIn:    expiresIn,
	}, nil
}

func randomOAuthValue() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func (h *Handler) newOAuthAttempt() (string, string, error) {
	state, err := randomOAuthValue()
	if err != nil {
		return "", "", err
	}
	nonce, err := randomOAuthValue()
	if err != nil {
		return "", "", err
	}
	now := time.Now()
	h.oauthMu.Lock()
	if h.oauthAttempts == nil {
		h.oauthAttempts = make(map[string]oauthAttempt)
	}
	for key, attempt := range h.oauthAttempts {
		if !attempt.ExpiresAt.After(now) {
			delete(h.oauthAttempts, key)
		}
	}
	h.oauthAttempts[state] = oauthAttempt{Nonce: nonce, ExpiresAt: now.Add(oauthAttemptLifetime)}
	h.oauthMu.Unlock()
	return state, nonce, nil
}

func (h *Handler) consumeOAuthAttempt(state string) (oauthAttempt, bool) {
	if state == "" {
		return oauthAttempt{}, false
	}
	h.oauthMu.Lock()
	defer h.oauthMu.Unlock()
	attempt, ok := h.oauthAttempts[state]
	delete(h.oauthAttempts, state)
	return attempt, ok && attempt.ExpiresAt.After(time.Now())
}

func jwtStringClaim(token, claim string) string {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims map[string]any
	if json.Unmarshal(payload, &claims) != nil {
		return ""
	}
	value, _ := claims[claim].(string)
	return value
}

func (h *Handler) GetAuthUrl(w http.ResponseWriter, r *http.Request) {
	state, nonce, err := h.newOAuthAttempt()
	if err != nil {
		h.returnError(w, err)
		return
	}
	query := url.Values{
		"redirect_uri":  {"http://localhost/redirect"},
		"client_id":     {"riot-client"},
		"response_type": {"token id_token"},
		"nonce":         {nonce},
		"state":         {state},
		"scope":         {"openid link ban lol_region"},
	}
	// Standard implicit flow — works for all unofficial/community apps.
	// offline_access is restricted to officially registered Riot partner apps only.
	h.returnAny(w, map[string]string{"auth_url": riotClientAuthURL + "?" + query.Encode()})
}

func (h *Handler) PostAuthToken(w http.ResponseWriter, r *http.Request) {
	var body AuthTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.returnError(w, err)
		return
	}
	tokens, err := extractAllTokens(body.URL)
	if err != nil {
		h.returnError(w, err)
		return
	}
	attempt, ok := h.consumeOAuthAttempt(tokens.State)
	if !ok {
		h.returnError(w, fmt.Errorf("the Riot login response is missing, expired, or belongs to another login attempt"))
		return
	}
	if nonce := jwtStringClaim(tokens.IDToken, "nonce"); nonce == "" || nonce != attempt.Nonce {
		h.returnError(w, fmt.Errorf("the Riot login response nonce did not match the login attempt"))
		return
	}
	var entitlements struct {
		EntitlementsToken string `json:"entitlements_token"`
	}
	if err := postJSON("https://entitlements.auth.riotgames.com/api/token/v1", tokens.AccessToken, []byte("{}"), &entitlements); err != nil {
		h.returnError(w, err)
		return
	}
	var userInfo struct {
		Sub  string `json:"sub"`
		Acct struct {
			GameName string `json:"game_name"`
			TagLine  string `json:"tag_line"`
		} `json:"acct"`
	}
	if err := getJSON("https://auth.riotgames.com/userinfo", tokens.AccessToken, &userInfo); err != nil {
		h.returnError(w, err)
		return
	}
	var geoResult struct {
		Affinities struct {
			Live string `json:"live"`
		} `json:"affinities"`
	}
	payloadBytes, _ := json.Marshal(map[string]string{"id_token": tokens.IDToken})
	if err := putJSON("https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant", tokens.AccessToken, payloadBytes, &geoResult); err != nil {
		h.returnError(w, err)
		return
	}
	h.returnAny(w, &AuthTokenResponse{
		AccessToken:       tokens.AccessToken,
		EntitlementsToken: entitlements.EntitlementsToken,
		ExpiresIn:         tokens.ExpiresIn,
		Puuid:             userInfo.Sub,
		Region:            geoResult.Affinities.Live,
		GameName:          userInfo.Acct.GameName,
		TagLine:           userInfo.Acct.TagLine,
	})
}

type SsidReauthRequest struct {
	Cookies string `json:"cookies"` // full cookie string e.g. "ssid=xxx; sub=yyy; ..."
}

type riotClientReauthPayload struct {
	ACRValues           string `json:"acr_values"`
	Claims              string `json:"claims"`
	ClientID            string `json:"client_id"`
	CodeChallenge       string `json:"code_challenge"`
	CodeChallengeMethod string `json:"code_challenge_method"`
	Nonce               string `json:"nonce"`
	RedirectURI         string `json:"redirect_uri"`
	ResponseType        string `json:"response_type"`
	Scope               string `json:"scope"`
}

type riotClientReauthResponse struct {
	Type     string `json:"type"`
	Response struct {
		Mode       string `json:"mode"`
		Parameters struct {
			URI string `json:"uri"`
		} `json:"parameters"`
	} `json:"response"`
}

func newRiotClientReauthRequest(cookies, nonce string) (*http.Request, error) {
	payload, err := json.Marshal(riotClientReauthPayload{
		ClientID:     "riot-client",
		Nonce:        nonce,
		RedirectURI:  "http://localhost/redirect",
		ResponseType: "token id_token",
		Scope:        "openid link ban lol_region lol summoner offline_access",
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodPost, riotClientReauthURL, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", riotClientReauthUserAgent)
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cookie", cookies)
	return req, nil
}

func parseRiotClientReauth(body []byte, expectedNonce string) (*extractedTokens, error) {
	var result riotClientReauthResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("invalid Riot reauth response: %w", err)
	}
	if result.Type == "auth" {
		return nil, errRiotLoginRequired
	}
	if result.Type != "response" || result.Response.Parameters.URI == "" {
		return nil, fmt.Errorf("unexpected Riot reauth response type %q", result.Type)
	}
	tokens, err := extractAllTokens(result.Response.Parameters.URI)
	if err != nil {
		return nil, fmt.Errorf("failed to extract Riot reauth tokens: %w", err)
	}
	if nonce := jwtStringClaim(tokens.IDToken, "nonce"); nonce == "" || nonce != expectedNonce {
		return nil, fmt.Errorf("Riot reauth returned an unexpected nonce")
	}
	return tokens, nil
}

func requestRiotClientReauth(cookies string) (*extractedTokens, []*http.Cookie, error) {
	nonce, err := randomOAuthValue()
	if err != nil {
		return nil, nil, err
	}
	req, err := newRiotClientReauthRequest(cookies, nonce)
	if err != nil {
		return nil, nil, err
	}
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("Riot cookie reauth request failed: %w", err)
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read Riot reauth response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("Riot cookie reauth returned HTTP %d", resp.StatusCode)
	}
	tokens, err := parseRiotClientReauth(responseBody, nonce)
	if err != nil {
		return nil, nil, err
	}
	return tokens, resp.Cookies(), nil
}

// PostSsidReauth uses the request shape observed from the Riot Client. A
// successful response rotates multiple auth cookies, which the caller must
// persist before the next maintenance refresh.
func (h *Handler) PostSsidReauth(w http.ResponseWriter, r *http.Request) {
	var body SsidReauthRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Cookies == "" {
		http.Error(w, `{"error":"missing_cookies"}`, http.StatusBadRequest)
		return
	}

	// Keep the refreshed token on the Riot Client audience. The web-only
	// audience can identify the player but is rejected by PVP endpoints.
	tokens, newCookies, err := requestRiotClientReauth(body.Cookies)
	if errors.Is(err, errRiotLoginRequired) {
		http.Error(w, `{"error":"login_required","message":"Riot requires this account to sign in again"}`, http.StatusUnauthorized)
		return
	}
	if err != nil {
		h.returnError(w, err)
		return
	}
	// Fetch entitlements with the fresh access_token
	var entitlements struct {
		EntitlementsToken string `json:"entitlements_token"`
	}
	if err := postJSON("https://entitlements.auth.riotgames.com/api/token/v1", tokens.AccessToken, []byte("{}"), &entitlements); err != nil {
		h.returnError(w, fmt.Errorf("failed to get entitlements: %w", err))
		return
	}

	var userInfo struct {
		Sub  string `json:"sub"`
		Acct struct {
			GameName string `json:"game_name"`
			TagLine  string `json:"tag_line"`
		} `json:"acct"`
	}
	if err := getJSON("https://auth.riotgames.com/userinfo", tokens.AccessToken, &userInfo); err != nil {
		h.returnError(w, fmt.Errorf("failed to identify refreshed Riot account: %w", err))
		return
	}
	var geoResult struct {
		Affinities struct {
			Live string `json:"live"`
		} `json:"affinities"`
	}
	payload, _ := json.Marshal(map[string]string{"id_token": tokens.IDToken})
	if err := putJSON("https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant", tokens.AccessToken, payload, &geoResult); err != nil {
		h.returnError(w, fmt.Errorf("failed to resolve refreshed Riot region: %w", err))
		return
	}

	// Merge newly received cookies with old cookies to rotate and maintain the session
	rotatedCookies := mergeCookies(body.Cookies, newCookies)

	h.returnAny(w, &AuthTokenResponse{
		AccessToken:       tokens.AccessToken,
		EntitlementsToken: entitlements.EntitlementsToken,
		ExpiresIn:         tokens.ExpiresIn,
		Puuid:             userInfo.Sub,
		Region:            geoResult.Affinities.Live,
		GameName:          userInfo.Acct.GameName,
		TagLine:           userInfo.Acct.TagLine,
		Cookies:           rotatedCookies,
	})
}

func mergeCookies(oldCookiesStr string, newCookies []*http.Cookie) string {
	cookieMap := make(map[string]string)

	if oldCookiesStr != "" {
		parts := strings.Split(oldCookiesStr, ";")
		for _, part := range parts {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			eqIdx := strings.Index(part, "=")
			if eqIdx == -1 {
				continue
			}
			name := part[:eqIdx]
			val := part[eqIdx+1:]
			cookieMap[name] = val
		}
	}

	now := time.Now()
	for _, cookie := range newCookies {
		if cookie.Name == "" {
			continue
		}
		if cookie.MaxAge < 0 || (!cookie.Expires.IsZero() && cookie.Expires.Before(now)) {
			delete(cookieMap, cookie.Name)
			continue
		}
		cookieMap[cookie.Name] = cookie.Value
	}

	names := make([]string, 0, len(cookieMap))
	for name := range cookieMap {
		names = append(names, name)
	}
	sort.Strings(names)

	var sb strings.Builder
	for index, name := range names {
		if index > 0 {
			sb.WriteString("; ")
		}
		sb.WriteString(name)
		sb.WriteString("=")
		sb.WriteString(cookieMap[name])
	}
	return sb.String()
}

type storeOffersResponse struct {
	Offers []map[string]any `json:"Offers"`
}

func (h *Handler) GetStorefront(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	shard := string(val.Shard)
	puuid := val.Player.Uuid
	apiURL := fmt.Sprintf("https://pd.%s.a.pvp.net/store/v3/storefront/%s", shard, puuid)
	var rawResponse map[string]any
	if err := runRiotJSON(http.MethodPost, apiURL, val.Header, map[string]any{}, &rawResponse); err != nil {
		h.returnError(w, err)
		return
	}
	if !hasSingleItemStoreOffers(rawResponse) {
		offersURL := fmt.Sprintf("https://pd.%s.a.pvp.net/store/v1/offers/", shard)
		var offers storeOffersResponse
		if err := runRiotJSON(http.MethodGet, offersURL, val.Header, nil, &offers); err != nil {
			h.returnError(w, err)
			return
		}
		attachSingleItemStoreOffers(rawResponse, offers.Offers)
	}
	h.returnAny(w, rawResponse)
}

func (h *Handler) GetWallet(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	shard := string(val.Shard)
	puuid := val.Player.Uuid
	apiURL := fmt.Sprintf("https://pd.%s.a.pvp.net/store/v1/wallet/%s", shard, puuid)
	var rawResponse map[string]any
	if err := runRiotJSON(http.MethodGet, apiURL, val.Header, nil, &rawResponse); err != nil {
		h.returnError(w, err)
		return
	}
	h.returnAny(w, rawResponse)
}

func attachSingleItemStoreOffers(storefront map[string]any, offers []map[string]any) {
	layout, ok := storefront["SkinsPanelLayout"].(map[string]any)
	if !ok {
		return
	}
	rawOfferIDs, ok := layout["SingleItemOffers"].([]any)
	if !ok {
		return
	}
	wantedOfferIDs := make(map[string]struct{}, len(rawOfferIDs))
	for _, rawOfferID := range rawOfferIDs {
		offerID, ok := rawOfferID.(string)
		if ok && offerID != "" {
			wantedOfferIDs[strings.ToLower(offerID)] = struct{}{}
		}
	}
	matched := make([]map[string]any, 0, len(wantedOfferIDs))
	for _, offer := range offers {
		offerID, _ := offer["OfferID"].(string)
		if _, ok := wantedOfferIDs[strings.ToLower(offerID)]; ok {
			matched = append(matched, offer)
		}
	}
	layout["SingleItemStoreOffers"] = matched
}

func hasSingleItemStoreOffers(storefront map[string]any) bool {
	layout, ok := storefront["SkinsPanelLayout"].(map[string]any)
	if !ok {
		return false
	}
	offers, ok := layout["SingleItemStoreOffers"].([]any)
	return ok && len(offers) > 0
}

func runRiotRaw(method, apiURL string, headers http.Header, body any) ([]byte, error) {
	var bodyReader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewBuffer(payload)
	}
	req, err := http.NewRequest(method, apiURL, bodyReader)
	if err != nil {
		return nil, err
	}
	for k, vals := range headers {
		for _, v := range vals {
			req.Header.Set(k, v)
		}
	}
	client := &http.Client{Timeout: 15 * time.Second}
	return riothttp.Do(client, req)
}

func runRiotJSON(method, apiURL string, headers http.Header, body any, result any) error {
	bodyBytes, err := runRiotRaw(method, apiURL, headers, body)
	if err != nil {
		return err
	}
	if result != nil && len(bodyBytes) > 0 {
		return json.Unmarshal(bodyBytes, result)
	}
	return nil
}
