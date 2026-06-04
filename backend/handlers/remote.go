package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/truearken/valclient/valclient"
)

const clientPlatform = "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9"

var clientVersionCached string
var versionOnce sync.Once

type remoteAuthHeaders struct {
	AccessToken       string
	EntitlementsToken string
	Puuid             string
	Region            string
}

func (h *Handler) SetLocalClient(val *valclient.ValClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.Val = val
}

func getRiotClientVersion() string {
	versionOnce.Do(func() {
		resp, err := http.Get("https://valorant-api.com/v1/version")
		if err != nil {
			clientVersionCached = "release-08.10-shipping-23-2512128"
			return
		}
		defer resp.Body.Close()
		var result struct {
			Data struct {
				RiotClientVersion string `json:"riotClientVersion"`
			} `json:"data"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			clientVersionCached = "release-08.10-shipping-23-2512128"
			return
		}
		clientVersionCached = result.Data.RiotClientVersion
	})
	return clientVersionCached
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
	return &remoteAuthHeaders{
		AccessToken:       accessToken,
		EntitlementsToken: entitlementsToken,
		Puuid:             puuid,
		Region:            region,
	}, true, nil
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
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Riot API returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}
	return json.NewDecoder(resp.Body).Decode(result)
}

func getJSON(apiURL, accessToken string, result any) error {
	req, err := http.NewRequest(http.MethodGet, apiURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Riot API returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}
	return json.NewDecoder(resp.Body).Decode(result)
}

func putJSON(apiURL, accessToken string, payload []byte, result any) error {
	req, err := http.NewRequest(http.MethodPut, apiURL, bytes.NewBuffer(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Riot API returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}
	return json.NewDecoder(resp.Body).Decode(result)
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
}

func extractTokens(redirectURL string) (string, string, int, error) {
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
		return "", "", 0, err
	}
	accessToken := values.Get("access_token")
	idToken := values.Get("id_token")
	if accessToken == "" {
		return "", "", 0, fmt.Errorf("no access token found in redirect URL")
	}
	expiresIn := 3600
	if rawExpiresIn := values.Get("expires_in"); rawExpiresIn != "" {
		if parsed, err := strconv.Atoi(rawExpiresIn); err == nil && parsed > 0 {
			expiresIn = parsed
		}
	}
	return accessToken, idToken, expiresIn, nil
}

func (h *Handler) GetAuthUrl(w http.ResponseWriter, r *http.Request) {
	authURL := "https://auth.riotgames.com/authorize?redirect_uri=http%3A%2F%2Flocalhost%2Fredirect&client_id=riot-client&response_type=token%20id_token&nonce=1&scope=openid%20link%20ban%20lol_region%20account"
	h.returnAny(w, map[string]string{"auth_url": authURL})
}

func (h *Handler) PostAuthToken(w http.ResponseWriter, r *http.Request) {
	var body AuthTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.returnError(w, err)
		return
	}
	accessToken, idToken, expiresIn, err := extractTokens(body.URL)
	if err != nil {
		h.returnError(w, err)
		return
	}
	var entitlements struct {
		EntitlementsToken string `json:"entitlements_token"`
	}
	if err := postJSON("https://entitlements.auth.riotgames.com/api/token/v1", accessToken, []byte("{}"), &entitlements); err != nil {
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
	if err := getJSON("https://auth.riotgames.com/userinfo", accessToken, &userInfo); err != nil {
		h.returnError(w, err)
		return
	}
	var geoResult struct {
		Affinities struct {
			Live string `json:"live"`
		} `json:"affinities"`
	}
	payloadBytes, _ := json.Marshal(map[string]string{"id_token": idToken})
	if err := putJSON("https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant", accessToken, payloadBytes, &geoResult); err != nil {
		h.returnError(w, err)
		return
	}
	h.returnAny(w, &AuthTokenResponse{
		AccessToken:       accessToken,
		EntitlementsToken: entitlements.EntitlementsToken,
		ExpiresIn:         expiresIn,
		Puuid:             userInfo.Sub,
		Region:            geoResult.Affinities.Live,
		GameName:          userInfo.Acct.GameName,
		TagLine:           userInfo.Acct.TagLine,
	})
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

func runRiotJSON(method, apiURL string, headers http.Header, body any, result any) error {
	var bodyReader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewBuffer(payload)
	}
	req, err := http.NewRequest(method, apiURL, bodyReader)
	if err != nil {
		return err
	}
	for k, vals := range headers {
		for _, v := range vals {
			req.Header.Set(k, v)
		}
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Riot storefront returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}
	if result != nil && len(bodyBytes) > 0 {
		return json.Unmarshal(bodyBytes, result)
	}
	return nil
}
