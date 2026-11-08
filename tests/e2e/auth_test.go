//go:build e2e

package e2e

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
)

// testUser is a static user of the dev Dex (deploy/dex/config.yaml.tpl).
const testUser = "alice@example.com"

// fetchToken gets an access token for user from the OIDC issuer with the
// password grant, as tests and scripts do without a browser. Every dev user's
// password is "password".
func fetchToken(issuer, user string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	form := url.Values{
		"grant_type": {"password"},
		"client_id":  {"kb-cli"},
		"username":   {user},
		"password":   {"password"},
		"scope":      {"openid email profile"},
	}
	for {
		token, err := requestToken(ctx, issuer+"/token", form)
		if err == nil {
			return token, nil
		}
		if ctx.Err() != nil {
			return "", err
		}
		time.Sleep(time.Second)
	}
}

func requestToken(ctx context.Context, endpoint string, form url.Values) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	var body struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("%s: %s", endpoint, res.Status)
	}
	if res.StatusCode != http.StatusOK || body.AccessToken == "" {
		return "", fmt.Errorf("%s: %s %s", endpoint, res.Status, body.Error)
	}
	return body.AccessToken, nil
}

// bearer returns an HTTP client sending token as a bearer token; an empty
// token sends none.
func bearer(token string) *http.Client {
	if token == "" {
		return http.DefaultClient
	}
	return &http.Client{Transport: bearerTransport{token: token, next: http.DefaultTransport}}
}

type bearerTransport struct {
	token string
	next  http.RoundTripper
}

func (t bearerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("Authorization", "Bearer "+t.token)
	return t.next.RoundTrip(req)
}

// TestGatewayRequiresToken checks that the gateway rejects calls without a
// valid token before they reach a service.
func TestGatewayRequiresToken(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), testTimeout)
	defer cancel()
	waitReady(ctx, t, newClients(kb.gateway, kb.token))

	for name, token := range map[string]string{
		"no token":      "",
		"invalid token": "not-a-jwt",
		"forged token":  kb.token[:strings.LastIndex(kb.token, ".")+1] + "c2lnbmF0dXJl",
	} {
		c := newClients(kb.gateway, token)
		_, err := c.listDocuments.CallUnary(ctx, connect.NewRequest(&documentv1.ListDocumentsRequest{}))
		if connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Errorf("%s: ListDocuments err = %v, want code %s", name, err, connect.CodeUnauthenticated)
		}
	}
}
