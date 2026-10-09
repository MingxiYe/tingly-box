package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tingly-dev/tingly-box/internal/constant"
	"github.com/tingly-dev/tingly-box/internal/ratelimit"
)

// fixedLimiter denies every call with a fixed RetryAfter and records what it
// was asked, so the middleware's routing/scoping logic is tested without
// depending on bucket math (covered in package ratelimit).
type fixedLimiter struct {
	allow      bool
	retryAfter time.Duration
	calls      []struct {
		key   string
		limit int
	}
}

func (f *fixedLimiter) Allow(key string, limit int) ratelimit.Decision {
	f.calls = append(f.calls, struct {
		key   string
		limit int
	}{key, limit})
	if f.allow {
		return ratelimit.Decision{Allowed: true}
	}
	return ratelimit.Decision{Allowed: false, RetryAfter: f.retryAfter}
}

// newRateLimitTestRouter stands in for ModelAuthMiddleware by seeding the
// context the way auth.go does for the given principal.
func newRateLimitTestRouter(l ratelimit.Limiter, authKind, keyID string, rpm int) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	seed := func(c *gin.Context) {
		c.Set(constant.CtxKeyAuthKind, authKind)
		if authKind == constant.AuthKindSharingKey {
			c.Set(constant.CtxKeySharingKeyID, keyID)
			c.Set(constant.CtxKeySharingKeyRPMLimit, rpm)
		}
		c.Next()
	}
	ok := func(c *gin.Context) { c.Status(http.StatusOK) }
	r.POST("/tingly/team/v1/messages", seed, SharingKeyRateLimitMiddleware(l), ok)
	r.GET("/tingly/team/v1/models", seed, SharingKeyRateLimitMiddleware(l), ok)
	return r
}

func do(r http.Handler, method, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestSharingKeyRateLimit_DeniesWith429AndRetryAfter(t *testing.T) {
	l := &fixedLimiter{allow: false, retryAfter: 1500 * time.Millisecond}
	r := newRateLimitTestRouter(l, constant.AuthKindSharingKey, "tb-share-abc", 60)

	w := do(r, http.MethodPost, "/tingly/team/v1/messages")
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429; body=%s", w.Code, w.Body.String())
	}
	// 1.5s rounds up to 2 whole seconds.
	if got := w.Header().Get("Retry-After"); got != "2" {
		t.Fatalf("Retry-After = %q, want \"2\"", got)
	}
	if len(l.calls) != 1 || l.calls[0].key != "tb-share-abc" || l.calls[0].limit != 60 {
		t.Fatalf("limiter called with %+v, want key tb-share-abc limit 60", l.calls)
	}
	body := w.Body.String()
	for _, want := range []string{`"type":"rate_limit_error"`, "60 requests/minute"} {
		if !contains(body, want) {
			t.Fatalf("body %s missing %s", body, want)
		}
	}
}

func TestSharingKeyRateLimit_AllowsWhenLimiterAllows(t *testing.T) {
	l := &fixedLimiter{allow: true}
	r := newRateLimitTestRouter(l, constant.AuthKindSharingKey, "tb-share-abc", 60)
	if w := do(r, http.MethodPost, "/tingly/team/v1/messages"); w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if len(l.calls) != 1 {
		t.Fatalf("limiter should be consulted once, got %d", len(l.calls))
	}
}

func TestSharingKeyRateLimit_SkipsGlobalModelToken(t *testing.T) {
	l := &fixedLimiter{allow: false, retryAfter: time.Second}
	r := newRateLimitTestRouter(l, constant.AuthKindGlobalModelToken, "", 0)
	if w := do(r, http.MethodPost, "/tingly/team/v1/messages"); w.Code != http.StatusOK {
		t.Fatalf("global model token must bypass the limiter; status = %d", w.Code)
	}
	if len(l.calls) != 0 {
		t.Fatalf("limiter must not be consulted for the global token, got %d calls", len(l.calls))
	}
}

func TestSharingKeyRateLimit_SkipsUnlimitedKeyAndGET(t *testing.T) {
	l := &fixedLimiter{allow: false, retryAfter: time.Second}

	// rpm_limit 0 = unlimited.
	r := newRateLimitTestRouter(l, constant.AuthKindSharingKey, "tb-share-abc", 0)
	if w := do(r, http.MethodPost, "/tingly/team/v1/messages"); w.Code != http.StatusOK {
		t.Fatalf("unlimited key denied: status = %d", w.Code)
	}

	// GET discovery endpoints are not counted even for a limited key.
	r = newRateLimitTestRouter(l, constant.AuthKindSharingKey, "tb-share-abc", 1)
	if w := do(r, http.MethodGet, "/tingly/team/v1/models"); w.Code != http.StatusOK {
		t.Fatalf("GET must bypass the limiter; status = %d", w.Code)
	}
	if len(l.calls) != 0 {
		t.Fatalf("limiter must not be consulted, got %d calls", len(l.calls))
	}
}

func TestSharingKeyRateLimit_NilLimiterIsNoop(t *testing.T) {
	r := newRateLimitTestRouter(nil, constant.AuthKindSharingKey, "tb-share-abc", 1)
	for i := 0; i < 5; i++ {
		if w := do(r, http.MethodPost, "/tingly/team/v1/messages"); w.Code != http.StatusOK {
			t.Fatalf("nil limiter must pass everything; status = %d", w.Code)
		}
	}
}

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
